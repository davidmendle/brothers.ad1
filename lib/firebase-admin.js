const admin = require("firebase-admin");
const fs = require("fs");
const { ExternalAccountClient } = require("google-auth-library");
const { getVercelOidcToken } = require("@vercel/oidc");

let appInstance;
let restAuthInstance;
let workloadIdentityCredential;
const restAuthUserCache = new Map();

const requiredWebEnvKeys = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_APP_ID",
  "FIREBASE_MESSAGING_SENDER_ID"
];

const requiredWorkloadIdentityEnvKeys = [
  "GCP_PROJECT_ID",
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
];

const firebaseAdminScopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/firebase.messaging",
  "https://www.googleapis.com/auth/identitytoolkit",
  "https://www.googleapis.com/auth/userinfo.email"
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
  const missing = keys.filter((key) => !firebaseConfigValue(key));
  if (keys.includes("FIREBASE_PROJECT_ID") && firebaseConfigValue("FIREBASE_PROJECT_ID") !== knownFirebaseProjectId) {
    missing.push("FIREBASE_PROJECT_ID");
  }
  return Array.from(new Set(missing));
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

function validServiceAccountCredentials(credentials = {}) {
  const projectId = String(credentials.projectId || "").trim();
  const clientEmail = String(credentials.clientEmail || "").trim().toLowerCase();
  const privateKey = String(credentials.privateKey || "").replace(/\\n/g, "\n").trim();
  return projectId === knownFirebaseProjectId
    && clientEmail.endsWith(`@${knownFirebaseProjectId}.iam.gserviceaccount.com`)
    && privateKey.includes("-----BEGIN PRIVATE KEY-----")
    && privateKey.includes("-----END PRIVATE KEY-----");
}

function workloadIdentityConfig() {
  const projectId = envValue("GCP_PROJECT_ID");
  const projectNumber = envValue("GCP_PROJECT_NUMBER");
  const serviceAccountEmail = envValue("GCP_SERVICE_ACCOUNT_EMAIL").toLowerCase();
  const poolId = envValue("GCP_WORKLOAD_IDENTITY_POOL_ID");
  const providerId = envValue("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID");
  const safeResourceId = /^[a-z][a-z0-9-]{2,31}$/;

  if (
    projectId !== knownFirebaseProjectId
    || !/^\d{6,20}$/.test(projectNumber)
    || !serviceAccountEmail.endsWith(`@${knownFirebaseProjectId}.iam.gserviceaccount.com`)
    || !safeResourceId.test(poolId)
    || !safeResourceId.test(providerId)
  ) {
    return null;
  }

  return {
    projectId,
    projectNumber,
    serviceAccountEmail,
    poolId,
    providerId
  };
}

function buildWorkloadIdentityClientOptions(config, tokenSupplier = getVercelOidcToken) {
  const providerResource = `projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
  const providerAudience = `https://iam.googleapis.com/${providerResource}`;
  return {
    type: "external_account",
    audience: `//iam.googleapis.com/${providerResource}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    scopes: firebaseAdminScopes,
    subject_token_supplier: {
      getSubjectToken: () => tokenSupplier({ audience: providerAudience })
    }
  };
}

function getWorkloadIdentityCredential(config) {
  if (workloadIdentityCredential) return workloadIdentityCredential;

  const authClient = ExternalAccountClient.fromJSON(buildWorkloadIdentityClientOptions(config));

  if (!authClient) {
    throw new Error("Vercel workload identity credentials could not be initialized.");
  }

  workloadIdentityCredential = {
    async getAccessToken() {
      const result = await authClient.getAccessToken();
      const accessToken = String(result?.token || "").trim();
      if (!accessToken) {
        throw new Error("Google workload identity did not return an access token.");
      }
      const expiryMs = Number(authClient.credentials?.expiry_date || 0) - Date.now();
      return {
        access_token: accessToken,
        expires_in: Math.max(60, Math.floor(expiryMs > 0 ? expiryMs / 1000 : 3600))
      };
    }
  };

  return workloadIdentityCredential;
}

function getFirebaseCredentialsSource() {
  const explicitJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (explicitJson) {
    if (explicitJson.startsWith("{")) {
      try {
        const parsed = JSON.parse(explicitJson);
        const credentials = {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n")
        };
        if (validServiceAccountCredentials(credentials)) {
          return {
            type: "service-account-json",
            credentials
          };
        }
      } catch (_error) {
        return null;
      }
    }
    const fromFile = readJsonFile(explicitJson);
    const fileCredentials = {
      projectId: fromFile?.project_id,
      clientEmail: fromFile?.client_email,
      privateKey: String(fromFile?.private_key || "").replace(/\\n/g, "\n")
    };
    if (validServiceAccountCredentials(fileCredentials)) {
      return {
        type: "service-account-file",
        credentials: fileCredentials
      };
    }
  }

  const projectId = firebaseConfigValue("FIREBASE_PROJECT_ID");
  const clientEmail = envValue("FIREBASE_CLIENT_EMAIL");
  const privateKey = envValue("FIREBASE_PRIVATE_KEY");

  const credentials = {
    projectId,
    clientEmail,
    privateKey: String(privateKey || "").replace(/\\n/g, "\n")
  };
  if (validServiceAccountCredentials(credentials)) {
    return {
      type: "service-account-env",
      credentials
    };
  }

  const oidcConfig = workloadIdentityConfig();
  if (oidcConfig) {
    return {
      type: "vercel-oidc",
      credentials: null,
      oidcConfig
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
    credential: source.type === "vercel-oidc"
      ? getWorkloadIdentityCredential(source.oidcConfig)
      : source.credentials
        ? admin.credential.cert(source.credentials)
        : admin.credential.applicationDefault(),
    projectId: firebaseConfigValue("FIREBASE_PROJECT_ID")
  };

  const storageBucket = firebaseConfigValue("FIREBASE_STORAGE_BUCKET");
  if (storageBucket) {
    options.storageBucket = storageBucket;
  }

  appInstance = admin.apps.length ? admin.app() : admin.initializeApp(options);
  return appInstance;
}

function getFirestore() {
  const app = getFirebaseAdminApp();
  return app ? admin.firestore(app) : null;
}

function getFirebaseStorageBucket() {
  const app = getFirebaseAdminApp();
  return app ? admin.storage(app).bucket(firebaseConfigValue("FIREBASE_STORAGE_BUCKET")) : null;
}

function getFirebaseAuth() {
  const app = getFirebaseAdminApp();
  return app ? admin.auth(app) : getFirebaseRestAuth();
}

function getFirebaseRestAuth() {
  if (restAuthInstance) return restAuthInstance;
  if (missingFirebaseConfigKeys(requiredWebEnvKeys).length !== 0) return null;
  const apiKey = firebaseConfigValue("FIREBASE_API_KEY");
  const projectId = firebaseConfigValue("FIREBASE_PROJECT_ID");
  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;

  function decodeVerifiedTokenClaims(idToken) {
    try {
      const [, payloadSegment] = String(idToken || "").split(".");
      if (!payloadSegment) return null;
      const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
      const issuer = `https://securetoken.google.com/${projectId}`;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.aud !== projectId || payload.iss !== issuer) return null;
      if (!payload.sub || Number(payload.exp || 0) <= nowSeconds || Number(payload.iat || 0) > nowSeconds + 60) return null;
      return payload;
    } catch (_error) {
      return null;
    }
  }

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
    const claims = decodeVerifiedTokenClaims(idToken);
    if (!claims || claims.sub !== user.localId) {
      throw new Error("Firebase token claims could not be verified.");
    }
    const provider = String(claims.firebase?.sign_in_provider || "").trim();
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
      auth_time: Number(claims.auth_time || 0),
      exp: Number(claims.exp || 0),
      iat: Number(claims.iat || 0),
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
  const missingWorkloadIdentity = requiredWorkloadIdentityEnvKeys.filter((key) => !envValue(key));
  const missingAdmin = credentialSource
    ? []
    : missingWorkloadIdentity.length
      ? missingWorkloadIdentity
      : ["FIREBASE_SERVICE_ACCOUNT_JSON_OR_VERCEL_OIDC"];
  const missingWeb = missingFirebaseConfigKeys(requiredWebEnvKeys);
  return {
    enabled: Boolean(missingWeb.length === 0 && (credentialSource || String(process.env.FIREBASE_REST_AUTH_FALLBACK ?? "true").toLowerCase() !== "false")),
    adminConfigured: missingAdmin.length === 0,
    adminCredentialSource: credentialSource?.type || "",
    restAuthFallback: Boolean(!credentialSource && missingWeb.length === 0),
    webConfigured: missingWeb.length === 0,
    knownProjectId: knownFirebaseProjectId,
    usingKnownProjectDefaults: Boolean(!envValue("FIREBASE_PROJECT_ID")),
    missingAdminEnv: Array.from(new Set(missingAdmin)),
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
  buildWorkloadIdentityClientOptions,
  getFirebaseAdminApp,
  getFirebaseAuth,
  getFirebasePublicConfig,
  getFirebaseStorageBucket,
  getFirestore,
  isFirebaseConfigured,
  missingEnvKeys
};
