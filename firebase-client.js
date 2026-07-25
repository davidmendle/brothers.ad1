// This app is served as native browser modules, so use Firebase's ESM CDN URLs.
// Bare imports like "firebase/app" require a bundler that this static Vercel app does not use.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

let firebaseConfigPromise;
let firebaseApp;
let firebaseAuth;
let googleProvider;

export async function loadFirebaseConfig() {
  if (!firebaseConfigPromise) {
    firebaseConfigPromise = fetch("/api/auth/config")
      .then((response) => response.json())
      .then((result) => result.firebase || { enabled: false });
  }
  return firebaseConfigPromise;
}

export async function ensureFirebaseAuth() {
  const config = await loadFirebaseConfig();
  if (!config.enabled) return null;
  if (!firebaseApp) {
    firebaseApp = getApps()[0] || initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      appId: config.appId,
      messagingSenderId: config.messagingSenderId,
      measurementId: config.measurementId
    });
    firebaseAuth = getAuth(firebaseApp);
  }
  return firebaseAuth;
}

function buildSessionPayload(idToken, options = {}) {
  return {
    idToken,
    accessCode: String(options.accessCode || "").trim(),
    accessToken: String(options.accessToken || "").trim()
  };
}

export async function loginWithFirebaseGoogle(options = {}) {
  const auth = await ensureFirebaseAuth();
  if (!auth) {
    throw new Error("Firebase authentication is not configured.");
  }
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
  }
  const credential = await signInWithPopup(auth, googleProvider);
  const idToken = await credential.user.getIdToken(true);
  const response = await fetch("/api/auth/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildSessionPayload(idToken, options))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Unable to establish the OS session.");
  }
  return result;
}

export async function logoutFirebaseSession() {
  await fetch("/api/auth/session/logout", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  if (firebaseAuth) {
    await firebaseAuth.signOut().catch(() => undefined);
  }
}

export async function fetchOsSession() {
  const response = await fetch("/api/auth/session");
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    return null;
  }
  return result;
}
