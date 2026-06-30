const admin = require("firebase-admin");
const fs = require("fs");

let appInstance;
let restAuthInstance;
const restAuthUserCache = new Map();

const requiredAdminEnvKeys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY"
];

const requiredWebEnvKeys = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_APP_ID",
  "FIREBASE_MESSAGING_SENDER_ID"
];

const knownFirebaseProjectId = "brothers-restoration-website";
const firebaseProjectDefaults = Object.freeze({
  FIREBASE_API_KEY: "AIzaSyBSXCPs5i_ulbZdxV-Ig0kGi0YkYSK_ak4",
  FIREBASE_PROJECT_ID: knownFirebaseProjectId,
  FIREBASE_AUTH_DOMAIN: "brothers-restoration-website.firebaseapp.com",
  FIREBASE_STORAGE_BUCKET: "brothers-restoration-website.firebasestorage.app",
  FIREBASE_APP_ID: "1:80592032671:web:a4a236c46dda1eb12263aa",
  FIREBASE_MESSAGING_SENDER_ID: "80592032671",
  FIREBASE_MEASUREMENT_ID: "G-6Q0QNW5P10"
});

function envValue(key) {
  const value = String(process.env[key] || "").trim();
  if (/^(replace_|your-|xxxxx|<)/i.test(value)) return "";
  return value;
}

function firebaseConfigValue(key) {
  return envValue(key) || firebaseProjectDefaults[key] || "";
}

function missingEnvKeys(keys) {
  return keys.filter((key) => !envValue(key));
}

function missingFirebaseConfigKeys(keys) {
  return keys.filter((key) => !firebaseConfigValue(key));
}

function isFirebaseConfigured() {
  return missingFirebaseConfigKeys(requiredWebEnvKeys).length === 0
    && (Boolean(getFirebaseCredentialsSource()) || String(process.env.FIREBASE_REST_AUTH_FALLBACK ?? "true").toLowerCase() !== "false");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function getFirebaseCredentialsSource() {
  const explicitJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (explicitJson) {
    if (explicitJson.startsWith("{")) {
      try {
        const parsed = JSON.parse(explicitJson);
        if (parsed.project_id && parsed.client_email && parsed.private_key) {
          return {
            type: "service-account-json",
            credentials: {
              projectId: parsed.project_id,
              clientEmail: parsed.client_email,
              privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n")
            }
          };
        }
      } catch (_error) {
        return null;
      }
    }
    const fromFile = readJsonFile(explicitJson);
    if (fromFile?.project_id && fromFile?.client_email && fromFile?.private_key) {
      return {
        type: "service-account-file",
        credentials: {
          projectId: fromFile.project_id,
          clientEmail: fromFile.client_email,
          privateKey: String(fromFile.private_key || "").replace(/\\n/g, "\n")
        }
      };
    }
  }

  const projectId = firebaseConfigValue("FIREBASE_PROJECT_ID");
  const clientEmail = envValue("FIREBASE_CLIENT_EMAIL");
  const privateKey = envValue("FIREBASE_PRIVATE_KEY");

  if (projectId && clientEmail && privateKey) {
    return {
      type: "service-account-env",
      credentials: {
        projectId,
        clientEmail,
        privateKey: String(privateKey || "").replace(/\\n/g, "\n")
      }
    };
  }

  const adcPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (adcPath && fs.existsSync(adcPath)) {
    return { type: "application-default", credentials: null };
  }

  return null;
}

function getFirebaseCredentials() {
  const source = getFirebaseCredentialsSource();
  if (!source) return null;
  if (!source.credentials) return null;
  return {
    projectId: source.credentials.projectId,
    clientEmail: source.credentials.clientEmail,
    privateKey: source.credentials.privateKey
  };
}

function getFirebaseAdminApp() {
  if (appInstance) return appInstance;
  const source = getFirebaseCredentialsSource();
  if (!source) return null;

  const options = {
    credential: source.credentials
      ? admin.credential.cert(source.credentials)
      : admin.credential.applicationDefault()
  };

  if (process.env.FIREBASE_STORAGE_BUCKET) {
    options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  }

  appInstance = admin.apps.length ? admin.app() : admin.initializeApp(options);
  return appInstance;
}

function getFirestore() {
  const app = getFirebaseAdminApp();
  return app ? admin.firestore(app) : null;
}

function getFirebaseAuth() {
  const app = getFirebaseAdminApp();
  return app ? admin.auth(app) : getFirebaseRestAuth();
}

function getFirebaseRestAuth() {
  if (restAuthInstance) return restAuthInstance;
  if (missingFirebaseConfigKeys(requiredWebEnvKeys).length !== 0) return null;
  const apiKey = firebaseConfigValue("FIREBASE_API_KEY");
  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;

  async function verifyToken(idToken) {
    const response = await fetch(lookupUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    if (!response.ok) {
      throw new Error("Firebase Google token could not be verified.");
    }
    const payload = await response.json();
    const user = payload.users?.[0];
    if (!user?.localId || !user?.email) {
      throw new Error("Firebase Google token did not include a verified user.");
    }
    const provider = user.providerUserInfo?.find((providerInfo) => providerInfo.providerId)?.providerId || "google.com";
    const authUser = {
      uid: user.localId,
      email: user.email,
      displayName: user.displayName || user.email,
      disabled: Boolean(user.disabled),
      emailVerified: Boolean(user.emailVerified)
    };
    restAuthUserCache.set(authUser.uid, authUser);
    return {
      uid: authUser.uid,
      email: authUser.email,
      name: authUser.displayName,
      email_verified: authUser.emailVerified,
      firebase: { sign_in_provider: provider }
    };
  }

  restAuthInstance = {
    verifyIdToken: verifyToken,
    verifySessionCookie: verifyToken,
    createSessionCookie: async (idToken) => idToken,
    getUser: async (uid) => restAuthUserCache.get(uid) || { uid, email: "", displayName: "", disabled: false },
    setCustomUserClaims: async () => undefined,
    revokeRefreshTokens: async () => undefined,
    listUsers: async () => ({ users: Array.from(restAuthUserCache.values()) })
  };
  return restAuthInstance;
}

function getFirebasePublicConfig() {
  const credentialSource = getFirebaseCredentialsSource();
  const missingAdmin = credentialSource ? [] : missingFirebaseConfigKeys(requiredAdminEnvKeys);
  const missingWeb = missingFirebaseConfigKeys(requiredWebEnvKeys);
  return {
    enabled: Boolean(missingWeb.length === 0 && (credentialSource || String(process.env.FIREBASE_REST_AUTH_FALLBACK ?? "true").toLowerCase() !== "false")),
    adminConfigured: missingAdmin.length === 0,
    adminCredentialSource: credentialSource?.type || "",
    restAuthFallback: Boolean(!credentialSource && missingWeb.length === 0),
    webConfigured: missingWeb.length === 0,
    knownProjectId: knownFirebaseProjectId,
    usingKnownProjectDefaults: Boolean(!envValue("FIREBASE_PROJECT_ID")),
    missingAdminEnv: missingAdmin,
    missingWebEnv: missingWeb,
    apiKey: firebaseConfigValue("FIREBASE_API_KEY"),
    authDomain: firebaseConfigValue("FIREBASE_AUTH_DOMAIN"),
    projectId: firebaseConfigValue("FIREBASE_PROJECT_ID"),
    storageBucket: firebaseConfigValue("FIREBASE_STORAGE_BUCKET"),
    appId: firebaseConfigValue("FIREBASE_APP_ID"),
    messagingSenderId: firebaseConfigValue("FIREBASE_MESSAGING_SENDER_ID"),
    measurementId: firebaseConfigValue("FIREBASE_MEASUREMENT_ID")
  };
}

module.exports = {
  getFirebaseAdminApp,
  getFirebaseAuth,
  getFirebasePublicConfig,
  getFirestore,
  isFirebaseConfigured,
  missingEnvKeys
};
