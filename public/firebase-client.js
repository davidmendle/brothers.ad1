// This app is served as native browser modules, so use Firebase's ESM CDN URLs.
// Bare imports like "firebase/app" require a bundler that this static Vercel app does not use.
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import { getAuth, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let firebaseConfigPromise;
let firebaseApp;
let firebaseAuth;
let firebaseDb;
let firebaseAnalytics;
let firebaseAnalyticsPromise;
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
  initializeFirebaseAnalytics(config);
  return firebaseAuth;
}

export async function ensureFirebaseDb() {
  const auth = await ensureFirebaseAuth();
  if (!auth) return null;
  if (!firebaseDb) {
    firebaseDb = getFirestore(firebaseApp);
  }
  return firebaseDb;
}

function initializeFirebaseAnalytics(config) {
  if (!config.measurementId || firebaseAnalytics || firebaseAnalyticsPromise) {
    return firebaseAnalyticsPromise || Promise.resolve(firebaseAnalytics || null);
  }
  firebaseAnalyticsPromise = analyticsIsSupported()
    .then((supported) => {
      if (!supported || !firebaseApp) return null;
      firebaseAnalytics = getAnalytics(firebaseApp);
      return firebaseAnalytics;
    })
    .catch(() => null);
  return firebaseAnalyticsPromise;
}

function buildSessionPayload(idToken, options = {}) {
  return {
    idToken,
    accessCode: String(options.accessCode || "").trim(),
    accessToken: String(options.accessToken || "").trim()
  };
}

export async function loginWithFirebasePassword(email, password, options = {}) {
  const auth = await ensureFirebaseAuth();
  if (!auth) {
    throw new Error("Firebase authentication is not configured.");
  }
  const credential = await signInWithEmailAndPassword(auth, email, password);
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

export async function fetchClientBusinessRecords() {
  const db = await ensureFirebaseDb();
  if (!db) return [];
  const snapshot = await getDocs(collection(db, "osBusinessRecords"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function fetchClientCommunityPosts() {
  const db = await ensureFirebaseDb();
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, "osCommunityPosts"), orderBy("createdAt", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function currentFirebaseUser() {
  if (!firebaseAuth?.currentUser) {
    throw new Error("Sign in with Google before using this secure Firebase feature.");
  }
  return firebaseAuth.currentUser;
}

function toTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hoursFromNow(hours = 48) {
  const safeHours = Math.max(1, Math.min(48, Number(hours) || 48));
  return new Date(Date.now() + safeHours * 60 * 60 * 1000).toISOString();
}

function randomString(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAccessCode(roleId = "contractor") {
  const prefix = roleId === "contractor" ? "CON" : "TRIAL";
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const code = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${prefix}-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

function normalizeAccessCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

export async function createClientAccessRequest(payload = {}) {
  const db = await ensureFirebaseDb();
  if (!db) throw new Error("Firebase is not ready for access requests.");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid Google email is required.");
  const requestDoc = {
    email,
    displayName: String(payload.displayName || payload.name || "").trim(),
    companyName: String(payload.companyName || "").trim(),
    requestedRole: String(payload.roleId || "contractor").trim(),
    status: "requested",
    requestedAt: new Date().toISOString(),
    expiresAt: hoursFromNow(48),
    source: "client-firestore"
  };
  const ref = await addDoc(collection(db, "osAccessRequests"), requestDoc);
  return {
    success: true,
    request: { id: ref.id, ...requestDoc },
    message: "Access request received. A Super Admin must approve it and issue the 48-hour link and access code."
  };
}

export async function createClientAccessGrant(payload = {}) {
  const db = await ensureFirebaseDb();
  const user = currentFirebaseUser();
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid Google email is required.");
  const roleId = String(payload.roleId || "contractor").trim();
  const ttlHours = Math.max(1, Math.min(48, Number(payload.ttlHours) || 48));
  const token = randomString(32);
  const accessCode = buildAccessCode(roleId);
  const now = new Date().toISOString();
  const grant = {
    email,
    displayName: String(payload.displayName || email).trim(),
    roleId,
    companyId: String(payload.companyId || "default-company").trim(),
    franchiseIds: Array.isArray(payload.franchiseIds) ? payload.franchiseIds : toTags(payload.franchiseIds),
    contractorId: String(payload.contractorId || `contractor-${sanitizeEmailKey(email)}`).trim(),
    accessScope: "48_hour_access",
    status: "issued",
    tokenHash: await sha256Hex(token),
    portalCodeHash: await sha256Hex(normalizeAccessCode(accessCode)),
    accessCodeId: `client-${randomString(4).replace(/[^a-z0-9]/gi, "").slice(0, 8)}`,
    failedCodeAttempts: 0,
    codeLockedUntil: "",
    expiresAt: hoursFromNow(ttlHours),
    createdAt: now,
    updatedAt: now,
    createdByUid: user.uid,
    createdByEmail: user.email || "",
    requestId: String(payload.requestId || "").trim(),
    permissionsOverride: payload.permissionsOverride && typeof payload.permissionsOverride === "object" ? payload.permissionsOverride : {},
    visibleTabIds: Array.isArray(payload.visibleTabIds) ? payload.visibleTabIds : [],
    visiblePageIds: Array.isArray(payload.visiblePageIds) ? payload.visiblePageIds : [],
    sectionOverrides: payload.sectionOverrides && typeof payload.sectionOverrides === "object" ? payload.sectionOverrides : {},
    assignedJobIds: Array.isArray(payload.assignedJobIds) ? payload.assignedJobIds : [],
    assignedTaskIds: Array.isArray(payload.assignedTaskIds) ? payload.assignedTaskIds : [],
    source: "client-firestore"
  };
  const ref = await addDoc(collection(db, "osAccessGrants"), grant);
  const accessLink = `${window.location.origin}/#access/${encodeURIComponent(token)}`;
  const publicGrant = { id: ref.id, ...grant };
  delete publicGrant.tokenHash;
  delete publicGrant.portalCodeHash;
  return {
    success: true,
    grant: publicGrant,
    accessCode,
    accessLink,
    emailDelivery: {
      status: "manual",
      message: "Generated in browser because server Firebase Admin credentials are not configured."
    }
  };
}

export async function createClientCommunityPost(payload = {}) {
  const db = await ensureFirebaseDb();
  const user = currentFirebaseUser();
  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  if (!title || !body) throw new Error("Post title and details are required.");
  const now = new Date().toISOString();
  const post = {
    title,
    body,
    tags: toTags(payload.tags),
    visibility: "contractors",
    authorUid: user.uid,
    authorEmail: user.email || "",
    authorRoleId: payload.roleId || "member",
    contractorId: payload.contractorId || "",
    companyId: payload.companyId || "default-company",
    franchiseIds: Array.isArray(payload.franchiseIds) ? payload.franchiseIds : [],
    comments: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    source: "client-firestore"
  };
  const ref = await addDoc(collection(db, "osCommunityPosts"), post);
  return { success: true, post: { id: ref.id, ...post } };
}

export async function addClientCommunityComment(postId, payload = {}) {
  const db = await ensureFirebaseDb();
  const user = currentFirebaseUser();
  const body = String(payload.body || "").trim();
  if (!postId) throw new Error("Post id is required.");
  if (!body) throw new Error("Comment body is required.");
  const comment = {
    id: `comment-${randomString(6).replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
    body,
    authorUid: user.uid,
    authorEmail: user.email || "",
    authorRoleId: payload.roleId || "member",
    createdAt: new Date().toISOString()
  };
  await updateDoc(doc(db, "osCommunityPosts", postId), {
    comments: arrayUnion(comment),
    updatedAt: new Date().toISOString()
  });
  return { success: true, comment };
}
