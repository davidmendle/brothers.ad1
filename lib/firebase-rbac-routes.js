const crypto = require("crypto");
const {
  buildEffectivePermissions,
  buildSeedTabsPagesSections,
  filterCollectionByPermission,
  getDefaultBusinessRecords,
  getDefaultCompanySettings,
  getDefaultFranchiseSettings,
  getSystemPermissions,
  getSystemRoles,
  normalizeUserRecord
} = require("./os-access-control");

const sessionCookieName = "brothers_os_session";
const sessionDurationMs = 1000 * 60 * 60 * 48;
const accessCodeMaxFailedAttempts = 5;
const accessCodeLockoutMs = 1000 * 60 * 15;
const primarySuperAdminEmail = "david@brothersrestoration.org";
const defaultBlockedEmails = [
  "chaim@brothersrestoration.org",
  "reznikchaim@gmail.com"
];
const COLLECTIONS = {
  users: "osUsers",
  roles: "osRoles",
  permissions: "osPermissions",
  tabs: "osTabs",
  pages: "osPages",
  pageSections: "osPageSections",
  companySettings: "osCompanySettings",
  franchiseSettings: "osFranchiseSettings",
  auditLogs: "osAuditLogs",
  accessRequests: "osAccessRequests",
  accessGrants: "osAccessGrants",
  businessRecords: "osBusinessRecords",
  communityPosts: "osCommunityPosts",
  employeeTicketSignoffs: "osEmployeeTicketSignoffs",
  workspaceRecords: "osWorkspaceRecords",
  workspaceSettings: "osWorkspaceSettings",
  workspaceAssets: "osWorkspaceAssets"
};

const WORKSPACE_ARRAY_FIELDS = [
  "files", "queue", "activity", "standardsOutputs", "learnedJargon",
  "equipmentDeployments", "dryLogs", "jobBoards", "contacts", "branches",
  "priceItems", "xactimateImports", "teamMembers", "tasks", "photoRecords", "contractorBills",
  "sketchRooms", "sketchWalls", "skillPacks", "dataVaults", "serviceRequests",
  "calloutSchedule", "timeEntries", "aiCopilotMemory", "aiCopilotMessages"
];
const WORKSPACE_SETTING_FIELDS = [
  "estimateDraft", "quickBooksConnection", "accountProfile",
  "performanceMetrics", "actionDashboard", "institutionalReview",
  "serviceSettings", "aiCopilotProfile", "industryProfile"
];
const WORKSPACE_ARRAY_FIELD_SET = new Set(WORKSPACE_ARRAY_FIELDS);
const WORKSPACE_SETTING_FIELD_SET = new Set(WORKSPACE_SETTING_FIELDS);
const FIELD_USER_EDITABLE_WORKSPACE_FIELDS = new Set([
  "files", "equipmentDeployments", "dryLogs", "jobBoards", "tasks",
  "photoRecords", "contractorBills", "serviceRequests", "timeEntries"
]);
const WORKSPACE_MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const WORKSPACE_MAX_RECORDS_PER_FIELD = 2500;
const WORKSPACE_BATCH_SIZE = 400;
const SENSITIVE_WORKSPACE_KEYS = new Set([
  "accesscode", "password", "passwordhash", "portalcodehash", "privatekey",
  "refreshtoken", "sessioncookie", "tokenhash", "idtoken"
]);

function sanitizeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function cleanWorkspaceValue(value, key = "", depth = 0) {
  if (depth > 12 || value === undefined) return undefined;
  const normalizedKey = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (SENSITIVE_WORKSPACE_KEYS.has(normalizedKey)) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if ((normalizedKey.endsWith("dataurl") || normalizedKey === "base64") && value.startsWith("data:")) return "";
    return value.length > 200000 ? value.slice(0, 200000) : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, WORKSPACE_MAX_RECORDS_PER_FIELD)
      .map((item) => cleanWorkspaceValue(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([nestedKey, nestedValue]) => [nestedKey, cleanWorkspaceValue(nestedValue, nestedKey, depth + 1)])
        .filter(([, nestedValue]) => nestedValue !== undefined)
    );
  }
  return String(value);
}

function workspaceRecordId(field, record, index = 0) {
  const candidate = record?.id
    || record?.uid
    || record?.jobId
    || record?.taskId
    || record?.invoiceId
    || record?.customerId
    || record?.email
    || record?.slug
    || record?.name;
  if (candidate) return String(candidate).trim().slice(0, 240);
  return `${field}-${index}-${hashSecret(JSON.stringify(record || {})).slice(0, 16)}`;
}

function workspaceRecordScopeKey(record = {}) {
  const franchiseId = String(record.franchiseId || "").trim();
  const branchId = String(record.branchId || "").trim();
  if (franchiseId) return `franchise:${franchiseId}`;
  if (branchId) return `branch:${branchId}`;
  return "unscoped";
}

function workspaceDocumentId(companyId, field, recordId, record = {}) {
  return hashSecret(`${companyId}\u0000${field}\u0000${workspaceRecordScopeKey(record)}\u0000${recordId}`).slice(0, 48);
}

function workspaceSettingDocumentId(companyId, field) {
  return hashSecret(`${companyId}\u0000setting\u0000${field}`).slice(0, 48);
}

function normalizePortalCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

function hashPortalCode(value) {
  return hashSecret(normalizePortalCode(value));
}

function portalCodeMatches(requiredHash, value) {
  const trimmed = String(value || "").trim().toUpperCase();
  return requiredHash === hashPortalCode(value) || requiredHash === hashSecret(trimmed);
}

function publicUserRecord(record = {}) {
  const safeRecord = { ...record };
  [
    "portalCodeHash",
    "passwordHash",
    "tokenHash",
    "failedCodeAttempts",
    "lastFailedCodeAt",
    "codeLockedUntil"
  ].forEach((field) => delete safeRecord[field]);
  return safeRecord;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function createAccessCode(roleId = "contractor") {
  const prefix = roleId === "contractor" ? "CON" : "TRIAL";
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 12 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `${prefix}-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isFutureIso(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function clampAccessHours(value) {
  const parsed = Number(value || 48);
  if (!Number.isFinite(parsed) || parsed <= 0) return 48;
  return Math.min(parsed, 48);
}

function getSessionTtlMs() {
  const parsed = Number(process.env.FIREBASE_SESSION_TTL_MS || sessionDurationMs);
  if (!Number.isFinite(parsed) || parsed <= 0) return sessionDurationMs;
  return Math.min(parsed, sessionDurationMs);
}

function getAllowedSignInProviders() {
  return new Set(
    String(process.env.FIREBASE_ALLOWED_SIGN_IN_PROVIDERS || "google.com")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function getInviteEmailConfig() {
  return {
    resendApiKey: String(process.env.RESEND_API_KEY || "").trim(),
    from: String(process.env.INVITE_FROM_EMAIL || process.env.OS_INVITE_FROM_EMAIL || "").trim(),
    replyTo: String(process.env.INVITE_REPLY_TO_EMAIL || "").trim()
  };
}

function inviteEmailConfigured() {
  const config = getInviteEmailConfig();
  return Boolean(config.resendApiKey && config.from);
}

function buildInviteEmail({ email, displayName, roleId, accessCode, accessLink, expiresAt, createdByEmail, onboardingMode }) {
  const name = displayName || email;
  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "48 hours";
  const roleLabel = String(roleId || "contractor").replace(/_/g, " ");
  const employeeInvite = onboardingMode === "employee_link";
  const subject = employeeInvite ? "Your Brothers OS employee portal link" : "Your Brothers OS access link and code";
  const text = [
    `Hi ${name},`,
    "",
    employeeInvite ? "Your employer invited you to the Brothers OS employee portal." : "You have been invited to Brothers OS.",
    `Access type: ${roleLabel}`,
    `Access link: ${accessLink}`,
    employeeInvite ? "" : `Access code: ${accessCode}`,
    `Expires: ${expiresLabel}`,
    "",
    employeeInvite
      ? "Open the one-time link and sign in with the same verified Google email address that received this invite."
      : "Sign in with the same Google email address that received this invite. Contractors and trial users must enter the access code on the login screen.",
    "",
    "If you did not request this access, ignore this email.",
    createdByEmail ? `Issued by: ${createdByEmail}` : ""
  ].filter(Boolean).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px">Your Brothers OS access is ready</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>${employeeInvite
        ? "Your employer invited you to the Brothers OS employee portal. Open this one-time link and sign in with the same verified Google email address."
        : "You have been invited to Brothers OS. Sign in with the same Google email address that received this invite."}</p>
      <p><strong>Access type:</strong> ${escapeHtml(roleLabel)}</p>
      ${employeeInvite ? "" : `<p><strong>Access code:</strong> <span style="font-size:18px">${escapeHtml(accessCode)}</span></p>`}
      <p><strong>Expires:</strong> ${escapeHtml(expiresLabel)}</p>
      <p><a href="${escapeHtml(accessLink)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Open Brothers OS</a></p>
      <p style="word-break:break-all;color:#475569">${escapeHtml(accessLink)}</p>
      <p>If you did not request this access, ignore this email.</p>
    </div>
  `;
  return { subject, text, html };
}

async function sendAccessInviteEmail(details) {
  const config = getInviteEmailConfig();
  if (!config.resendApiKey || !config.from) {
    return {
      status: "not_configured",
      message: "Invite email was not sent. Set RESEND_API_KEY and INVITE_FROM_EMAIL in Vercel."
    };
  }
  if (typeof fetch !== "function") {
    return {
      status: "failed",
      message: "Invite email was not sent because fetch is not available in this Node runtime."
    };
  }
  const email = buildInviteEmail(details);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: config.from,
      to: [details.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(config.replyTo || details.createdByEmail ? { reply_to: config.replyTo || details.createdByEmail } : {}),
      tags: [
        { name: "type", value: "os_access_invite" },
        { name: "role", value: String(details.roleId || "contractor").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "contractor" }
      ]
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: "failed",
      message: result.message || result.error || `Invite email failed with status ${response.status}.`
    };
  }
  return {
    status: "sent",
    provider: "resend",
    id: result.id || result.data?.id || ""
  };
}

function docDataWithId(doc) {
  return { id: doc.id, ...doc.data() };
}

function buildGrantUserFields(grant) {
  return {
    displayName: grant.displayName || grant.email,
    roleId: grant.roleId || "contractor",
    companyId: grant.companyId || "default-company",
    franchiseIds: Array.isArray(grant.franchiseIds) ? grant.franchiseIds : [],
    contractorId: grant.contractorId || "",
    accessGrantId: grant.id || grant.grantId || "",
    accessCodeId: grant.accessCodeId || "",
    accessExpiresAt: grant.expiresAt || "",
    accessScope: grant.accessScope || "48_hour_access",
    portalCodeHash: grant.portalCodeHash || "",
    permissionsOverride: grant.permissionsOverride && typeof grant.permissionsOverride === "object" ? grant.permissionsOverride : {},
    visibleTabIds: Array.isArray(grant.visibleTabIds) ? grant.visibleTabIds : [],
    visiblePageIds: Array.isArray(grant.visiblePageIds) ? grant.visiblePageIds : [],
    sectionOverrides: grant.sectionOverrides && typeof grant.sectionOverrides === "object" ? grant.sectionOverrides : {},
    assignedJobIds: Array.isArray(grant.assignedJobIds) ? grant.assignedJobIds : [],
    assignedTaskIds: Array.isArray(grant.assignedTaskIds) ? grant.assignedTaskIds : [],
    employerUid: grant.employerUid || "",
    employerEmail: grant.employerEmail || "",
    employerContractorId: grant.employerContractorId || grant.contractorId || "",
    onboardingMode: grant.onboardingMode || "",
    employmentStatus: grant.employmentStatus || "",
    phone: grant.phone || "",
    jobTitle: grant.jobTitle || "",
    disabled: false,
    status: "active"
  };
}

function createFirebaseRbacRouter(deps) {
  const {
    express,
    parseCookies,
    jsonError,
    getFirebaseAuth,
    getFirebasePublicConfig,
    getFirebaseStorageBucket,
    getFirestore,
    isFirebaseConfigured
  } = deps;

  const router = express.Router();

  function getCookieOptions(request, maxAge = sessionDurationMs) {
    const forwardedProto = String(request.get("x-forwarded-proto") || request.protocol || "").toLowerCase();
    const secure = forwardedProto === "https" || process.env.VERCEL === "1";
    return {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge
    };
  }

  async function writeAuditLog(db, entry) {
    await db.collection(COLLECTIONS.auditLogs).add({
      ...entry,
      createdAt: new Date().toISOString()
    });
  }

  async function seedDefaults(db) {
    const batch = db.batch();
    const roleDocs = await Promise.all(getSystemRoles().map((role) => db.collection(COLLECTIONS.roles).doc(role.id).get()));
    getSystemRoles().forEach((role, index) => {
      if (!roleDocs[index].exists) {
        batch.set(db.collection(COLLECTIONS.roles).doc(role.id), role, { merge: true });
      }
    });

    const systemPermissionEntries = Object.entries(getSystemPermissions());
    const permissionDocs = await Promise.all(systemPermissionEntries.map(([roleId]) => db.collection(COLLECTIONS.permissions).doc(roleId).get()));
    systemPermissionEntries.forEach(([roleId, permissions], index) => {
      const permissionDoc = permissionDocs[index];
      if (!permissionDoc.exists) {
        batch.set(db.collection(COLLECTIONS.permissions).doc(roleId), {
          roleId,
          ...permissions,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        return;
      }
      const current = permissionDoc.data() || {};
      const missingActions = Object.fromEntries(
        Object.entries(permissions.actions || {}).filter(([key]) => !(key in (current.actions || {})))
      );
      const missingDataAccess = Object.fromEntries(
        Object.entries(permissions.dataAccess || {}).filter(([key]) => !(key in (current.dataAccess || {})))
      );
      const patch = { roleId, updatedAt: new Date().toISOString() };
      if (Object.keys(missingActions).length) patch.actions = missingActions;
      if (Object.keys(missingDataAccess).length) patch.dataAccess = missingDataAccess;
      if (patch.actions || patch.dataAccess) {
        batch.set(db.collection(COLLECTIONS.permissions).doc(roleId), patch, { merge: true });
      }
    });

    const seeds = buildSeedTabsPagesSections();
    const [tabSnapshot, pageSnapshot, sectionSnapshot, companySnapshot, franchiseSnapshot, businessSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.tabs).get(),
      db.collection(COLLECTIONS.pages).get(),
      db.collection(COLLECTIONS.pageSections).get(),
      db.collection(COLLECTIONS.companySettings).doc("default").get(),
      db.collection(COLLECTIONS.franchiseSettings).doc("default-franchise").get(),
      db.collection(COLLECTIONS.businessRecords).limit(1).get()
    ]);

    const normalizeSeedText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const looksAutoGenerated = (doc, currentText, fallbackText = "") => {
      const key = normalizeSeedText(doc.id);
      const text = normalizeSeedText(currentText);
      const fallback = normalizeSeedText(fallbackText);
      return !text || text === key || text === fallback || String(currentText || "").startsWith("Workspace for ");
    };
    const existingTabIds = new Set(tabSnapshot.docs.map((doc) => doc.id));
    const existingPageIds = new Set(pageSnapshot.docs.map((doc) => doc.id));
    const existingSectionIds = new Set(sectionSnapshot.docs.map((doc) => doc.id));
    seeds.tabs
      .filter((tab) => !existingTabIds.has(tab.id))
      .forEach((tab) => batch.set(db.collection(COLLECTIONS.tabs).doc(tab.id), tab, { merge: true }));
    tabSnapshot.docs.forEach((doc) => {
      const seed = seeds.tabs.find((tab) => tab.id === doc.id);
      if (!seed) return;
      const current = doc.data() || {};
      const patch = {};
      if (looksAutoGenerated(doc, current.label, current.key)) patch.label = seed.label;
      if (looksAutoGenerated(doc, current.purpose, current.key)) patch.purpose = seed.purpose;
      if (Object.keys(patch).length) {
        batch.set(db.collection(COLLECTIONS.tabs).doc(doc.id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      }
    });
    seeds.pages
      .filter((page) => !existingPageIds.has(page.id))
      .forEach((page) => batch.set(db.collection(COLLECTIONS.pages).doc(page.id), page, { merge: true }));
    pageSnapshot.docs.forEach((doc) => {
      const seed = seeds.pages.find((page) => page.id === doc.id);
      if (!seed) return;
      const current = doc.data() || {};
      const patch = {};
      if (looksAutoGenerated(doc, current.title, current.routeKey)) patch.title = seed.title;
      if (looksAutoGenerated(doc, current.purpose, current.routeKey)) patch.purpose = seed.purpose;
      if (Object.keys(patch).length) {
        batch.set(db.collection(COLLECTIONS.pages).doc(doc.id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      }
    });
    seeds.sections
      .filter((section) => !existingSectionIds.has(section.id))
      .forEach((section) => batch.set(db.collection(COLLECTIONS.pageSections).doc(section.id), section, { merge: true }));
    if (!companySnapshot.exists) {
      batch.set(db.collection(COLLECTIONS.companySettings).doc("default"), getDefaultCompanySettings(), { merge: true });
    }
    if (!franchiseSnapshot.exists) {
      batch.set(db.collection(COLLECTIONS.franchiseSettings).doc("default-franchise"), getDefaultFranchiseSettings(), { merge: true });
    }
    if (businessSnapshot.empty) {
      getDefaultBusinessRecords().forEach((record) => {
        batch.set(db.collection(COLLECTIONS.businessRecords).doc(record.id), record, { merge: true });
      });
    }
    await batch.commit();
  }

  function buildAccessLink(request, token, onboardingMode = "") {
    const forwardedHost = String(request.get("x-forwarded-host") || request.get("host") || "").trim();
    const forwardedProto = String(request.get("x-forwarded-proto") || request.protocol || "https").split(",")[0];
    const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : "";
    const portalQuery = onboardingMode === "employee_link" ? "?portal=employee" : "";
    return `${origin}/${portalQuery}#access/${encodeURIComponent(token)}`;
  }

  function isBlockedEmail(email) {
    const blockedEmails = new Set([
      ...defaultBlockedEmails,
      ...String(process.env.BLOCKED_ADMIN_EMAILS || "")
        .split(",")
        .map((item) => normalizeEmail(item))
        .filter(Boolean)
    ]);
    return blockedEmails.has(normalizeEmail(email));
  }

  function isSuperAdminEmail(email) {
    const normalized = normalizeEmail(email);
    return !isBlockedEmail(normalized) && normalized === primarySuperAdminEmail;
  }

  function isOwnerIdentity(uid, email) {
    if (!isSuperAdminEmail(email)) return false;
    const configuredUid = String(process.env.FIREBASE_OWNER_UID || "").trim();
    return !configuredUid || configuredUid === String(uid || "").trim();
  }

  function getAllowedLoginEmails() {
    return new Set(
      String(process.env.FIREBASE_ALLOWED_LOGIN_EMAILS || primarySuperAdminEmail)
        .split(",")
        .map((item) => normalizeEmail(item))
        .filter(Boolean)
    );
  }

  function isOwnerOnlyLoginEnabled() {
    const value = String(process.env.FIREBASE_OWNER_ONLY_LOGIN ?? "true").trim().toLowerCase();
    return !["false", "0", "no", "off"].includes(value);
  }

  function assertAllowedLoginEmail(email) {
    if (!isOwnerOnlyLoginEnabled()) return { ok: true };
    const normalized = normalizeEmail(email);
    if (normalized && getAllowedLoginEmails().has(normalized) && !isBlockedEmail(normalized)) {
      return { ok: true };
    }
    return {
      ok: false,
      statusCode: 403,
      message: "Only david@brothersrestoration.org is approved to sign in to Brothers OS."
    };
  }

  function assertFallbackSuperAdminEmail(email, uid = "") {
    const allowedResult = assertAllowedLoginEmail(email);
    if (!allowedResult.ok) return allowedResult;
    if (isOwnerIdentity(uid, email)) return { ok: true };
    return {
      ok: false,
      statusCode: 503,
      message: "Firebase Admin credentials are required before any non-owner account can sign in, and the configured owner UID must match."
    };
  }

  async function findActiveAccessGrant(email, accessToken = "") {
    const db = getFirestore();
    const candidates = [];
    const normalizedEmail = normalizeEmail(email);
    if (!accessToken) return null;
    const tokenSnapshot = await db.collection(COLLECTIONS.accessGrants).where("tokenHash", "==", hashSecret(accessToken)).limit(1).get();
    tokenSnapshot.docs.forEach((doc) => candidates.push(docDataWithId(doc)));

    return candidates.find((grant) => {
      const status = String(grant.status || "issued").toLowerCase();
      return grant.email === normalizedEmail
        && status === "issued"
        && isFutureIso(grant.expiresAt);
    }) || null;
  }

  function assertAllowedProvider(decodedToken) {
    const provider = String(decodedToken.firebase?.sign_in_provider || "").trim();
    const allowedProviders = getAllowedSignInProviders();
    if (!provider || !allowedProviders.has(provider)) {
      return {
        ok: false,
        statusCode: 403,
        message: "Google sign-in is required for this platform. Ask the Super Admin to enable another provider only for a controlled fallback."
      };
    }
    if (decodedToken.email_verified === false) {
      return { ok: false, statusCode: 403, message: "A verified Google email is required before access can be granted." };
    }
    return { ok: true };
  }

  async function assertAccessCode(userRecord, accessCode, grant = null) {
    const requiredHash = grant?.portalCodeHash || userRecord.portalCodeHash || "";
    if (!requiredHash) return { ok: true };
    const lockoutUntil = grant?.codeLockedUntil || userRecord.codeLockedUntil || "";
    if (lockoutUntil && isFutureIso(lockoutUntil)) {
      return { ok: false, statusCode: 429, message: "Too many invalid access-code attempts. Try again after the temporary lockout expires." };
    }

    if (!portalCodeMatches(requiredHash, accessCode)) {
      const failedAttempts = Math.max(Number(grant?.failedCodeAttempts || userRecord.failedCodeAttempts || 0) + 1, 1);
      const now = new Date().toISOString();
      const updates = {
        failedCodeAttempts: failedAttempts,
        lastFailedCodeAt: now,
        updatedAt: now
      };
      if (failedAttempts >= accessCodeMaxFailedAttempts) {
        updates.codeLockedUntil = new Date(Date.now() + accessCodeLockoutMs).toISOString();
      }
      const db = firebaseAdminDataStoreConfigured() ? getFirestore() : null;
      if (db && grant?.id) {
        await db.collection(COLLECTIONS.accessGrants).doc(grant.id).set(updates, { merge: true });
      }
      const userDocId = userRecord.uid || userRecord.id;
      if (db && userDocId) {
        await db.collection(COLLECTIONS.users).doc(userDocId).set(updates, { merge: true });
      }
      return {
        ok: false,
        statusCode: failedAttempts >= accessCodeMaxFailedAttempts ? 429 : 403,
        message: failedAttempts >= accessCodeMaxFailedAttempts
          ? "Too many invalid access-code attempts. This portal is temporarily locked."
          : "A valid contractor access code is required for this portal."
      };
    }

    if (grant?.id && (grant.failedCodeAttempts || grant.codeLockedUntil)) {
      const db = firebaseAdminDataStoreConfigured() ? getFirestore() : null;
      if (db) {
        await db.collection(COLLECTIONS.accessGrants).doc(grant.id).set({
          failedCodeAttempts: 0,
          codeLockedUntil: "",
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    }
    return { ok: true };
  }

  async function assertStoredSessionAccess(userRecord) {
    const roleId = String(userRecord.roleId || "").trim();
    if (roleId === "super_admin" && !isOwnerIdentity(userRecord.uid || userRecord.id, userRecord.email)) {
      return { ok: false, statusCode: 403, message: "Super Admin access is restricted to the verified Brothers OS owner." };
    }
    if (userRecord.disabled || String(userRecord.status || "").toLowerCase() === "pending_access") {
      return { ok: false, statusCode: 403, message: "This email is not approved yet. Request trial access or ask the Super Admin for a contractor code." };
    }
    if (userRecord.accessExpiresAt && !isFutureIso(userRecord.accessExpiresAt)) {
      const db = getFirestore();
      await db.collection(COLLECTIONS.users).doc(userRecord.uid || userRecord.id).set({
        disabled: true,
        status: "expired",
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return { ok: false, statusCode: 403, message: "This access link has expired. Request a new 48-hour access link." };
    }
    return { ok: true };
  }

  async function assertSessionAccess(userRecord, options = {}) {
    const storedAccess = await assertStoredSessionAccess(userRecord);
    if (!storedAccess.ok) return storedAccess;
    const roleId = String(userRecord.roleId || "").trim();
    if (roleId !== "super_admin") {
      if (options.grant?.onboardingMode === "employee_link" && roleId === "worker") {
        return { ok: true };
      }
      const requiredHash = options.grant?.portalCodeHash || userRecord.portalCodeHash || "";
      if (!requiredHash) {
        return { ok: false, statusCode: 403, message: "This account does not have an active individual access code." };
      }
      return await assertAccessCode(userRecord, options.accessCode, options.grant);
    }
    return { ok: true };
  }

  async function ensureUserRecord(decodedToken, options = {}) {
    const db = getFirestore();
    const auth = getFirebaseAuth();
    await seedDefaults(db);

    const userRef = db.collection(COLLECTIONS.users).doc(decodedToken.uid);
    const snapshot = await userRef.get();
    const authUser = await auth.getUser(decodedToken.uid);
    const email = normalizeEmail(authUser.email || decodedToken.email);
    if (isBlockedEmail(email)) {
      const revokedRecord = normalizeUserRecord(decodedToken.uid, authUser, {
        roleId: "worker",
        disabled: true,
        status: "revoked",
        accessScope: "revoked"
      });
      await userRef.set({ ...revokedRecord, updatedAt: new Date().toISOString() }, { merge: true });
      await auth.setCustomUserClaims(decodedToken.uid, {
        roleId: "revoked",
        companyId: "",
        franchiseIds: [],
        contractorId: "",
        accessExpiresAt: ""
      });
      return { record: revokedRecord, grant: null };
    }
    const accessGrant = await findActiveAccessGrant(email, options.accessToken);
    const loginEmailAllowed = !isOwnerOnlyLoginEnabled() || getAllowedLoginEmails().has(email);
    const isSuper = loginEmailAllowed && isOwnerIdentity(decodedToken.uid, email);

    if (snapshot.exists) {
      const existing = normalizeUserRecord(decodedToken.uid, authUser, snapshot.data());
      const merged = isSuper
        ? {
            ...existing,
            roleId: "super_admin",
            disabled: false,
            status: "active",
            accessExpiresAt: "",
            accessGrantId: "",
            accessCodeId: "",
            portalCodeHash: "",
            contractorId: "",
            accessScope: "owner"
          }
        : accessGrant
          ? { ...existing, ...buildGrantUserFields(accessGrant) }
          : existing.roleId === "super_admin"
            ? {
                ...existing,
                roleId: "worker",
                disabled: true,
                status: "pending_access",
                accessExpiresAt: "",
                accessGrantId: "",
                accessCodeId: "",
                portalCodeHash: "",
                contractorId: "",
                accessScope: "unapproved"
              }
            : existing;
      const persisted = accessGrant && !isSuper
        ? { ...merged, status: "pending_access", updatedAt: new Date().toISOString() }
        : { ...merged, updatedAt: new Date().toISOString() };
      await userRef.set(persisted, { merge: true });
      if (!accessGrant || isSuper) {
        await auth.setCustomUserClaims(decodedToken.uid, {
          roleId: merged.roleId,
          companyId: merged.companyId,
          franchiseIds: merged.franchiseIds,
          contractorId: merged.contractorId || "",
          accessExpiresAt: merged.accessExpiresAt || ""
        });
      }
      return { record: merged, grant: accessGrant };
    }

    const candidateRecord = isSuper
      ? {
          roleId: "super_admin",
          disabled: false,
          status: "active",
          accessExpiresAt: "",
          accessGrantId: "",
          accessCodeId: "",
          portalCodeHash: "",
          contractorId: "",
          accessScope: "owner"
        }
      : accessGrant
        ? buildGrantUserFields(accessGrant)
        : { roleId: "worker", disabled: true, status: "pending_access", accessScope: "unapproved" };
    const record = normalizeUserRecord(decodedToken.uid, authUser, candidateRecord);
    await userRef.set(accessGrant && !isSuper ? { ...record, status: "pending_access" } : record, { merge: true });
    if (!accessGrant || isSuper) {
      await auth.setCustomUserClaims(decodedToken.uid, {
        roleId: record.roleId,
        companyId: record.companyId,
        franchiseIds: record.franchiseIds,
        contractorId: record.contractorId || "",
        accessExpiresAt: record.accessExpiresAt || ""
      });
    }
    return { record, grant: accessGrant };
  }

  async function activateAccessGrant(decodedToken, userRecord, grant, accessToken) {
    if (!grant?.id) return;
    const db = getFirestore();
    const auth = getFirebaseAuth();
    const grantRef = db.collection(COLLECTIONS.accessGrants).doc(grant.id);
    const userRef = db.collection(COLLECTIONS.users).doc(decodedToken.uid);
    const now = new Date().toISOString();
    const grantUpdates = {
      status: "active",
      activatedAt: now,
      tokenConsumedAt: now,
      tokenHash: "",
      firebaseUid: decodedToken.uid,
      failedCodeAttempts: 0,
      codeLockedUntil: "",
      updatedAt: now
    };
    const userUpdates = {
      ...userRecord,
      status: "active",
      disabled: false,
      employmentStatus: grant.onboardingMode === "employee_link" ? "active" : (userRecord.employmentStatus || ""),
      onboardingAcceptedAt: grant.onboardingMode === "employee_link" ? now : (userRecord.onboardingAcceptedAt || ""),
      updatedAt: now
    };
    const assertGrantStillUsable = (current = {}) => {
      if (String(current.status || "issued").toLowerCase() !== "issued"
        || current.tokenHash !== hashSecret(accessToken)
        || normalizeEmail(current.email) !== normalizeEmail(decodedToken.email)
        || !isFutureIso(current.expiresAt)) {
        const error = new Error("This access link was already used, expired, or does not match this Google account.");
        error.statusCode = 403;
        throw error;
      }
    };

    if (typeof db.runTransaction === "function") {
      await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(grantRef);
        if (!currentSnapshot.exists) {
          const error = new Error("This access link is no longer available.");
          error.statusCode = 403;
          throw error;
        }
        assertGrantStillUsable(currentSnapshot.data() || {});
        transaction.set(grantRef, grantUpdates, { merge: true });
        transaction.set(userRef, userUpdates, { merge: true });
      });
    } else {
      const currentSnapshot = await grantRef.get();
      if (!currentSnapshot.exists) {
        const error = new Error("This access link is no longer available.");
        error.statusCode = 403;
        throw error;
      }
      assertGrantStillUsable(currentSnapshot.data() || {});
      await grantRef.set(grantUpdates, { merge: true });
      await userRef.set(userUpdates, { merge: true });
    }
    await auth.setCustomUserClaims(decodedToken.uid, {
      roleId: userRecord.roleId,
      companyId: userRecord.companyId,
      franchiseIds: userRecord.franchiseIds || [],
      contractorId: userRecord.contractorId || "",
      accessExpiresAt: userRecord.accessExpiresAt || ""
    });
  }

  async function getRolePermissionDoc(roleId) {
    const db = getFirestore();
    const [roleDoc, permissionDoc] = await Promise.all([
      db.collection(COLLECTIONS.roles).doc(roleId).get(),
      db.collection(COLLECTIONS.permissions).doc(roleId).get()
    ]);
    return {
      role: roleDoc.exists ? roleDoc.data() : null,
      permissions: permissionDoc.exists ? permissionDoc.data() : getSystemPermissions()[roleId]
    };
  }

  async function getCurrentSession(request) {
    if (!isFirebaseConfigured()) {
      return { ok: false, statusCode: 503, message: "Firebase authentication is not configured." };
    }

    const cookieHeader = request.get("cookie");
    const cookies = parseCookies(cookieHeader);
    const sessionCookie = cookies[sessionCookieName];
    if (!sessionCookie) {
      return { ok: false, statusCode: 401, message: "Authentication required." };
    }

    try {
      const auth = getFirebaseAuth();
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      const providerResult = assertAllowedProvider(decoded);
      if (!providerResult.ok) return { ok: false, statusCode: providerResult.statusCode, message: providerResult.message };
      if (!firebaseAdminDataStoreConfigured()) {
        const emailResult = assertFallbackSuperAdminEmail(decoded.email, decoded.uid);
        if (!emailResult.ok) return { ok: false, statusCode: emailResult.statusCode, message: emailResult.message };
        const durationMs = fallbackSessionDurationMs(decoded);
        if (!durationMs) return { ok: false, statusCode: 401, message: "Authentication session is invalid or expired." };
        return {
          ok: true,
          session: buildFallbackSuperAdminSession(decoded, new Date(Date.now() + durationMs).toISOString())
        };
      }
      try {
        const ensured = await ensureUserRecord(decoded);
        const userRecord = ensured.record || ensured;
        const accessResult = await assertStoredSessionAccess(userRecord);
        if (!accessResult.ok) return accessResult;
        const rolePermission = await getRolePermissionDoc(userRecord.roleId);
        const effectivePermissions = buildEffectivePermissions(
          userRecord.roleId,
          userRecord.permissionsOverride || rolePermission.permissions || {}
        );
        return {
          ok: true,
          session: {
            uid: decoded.uid,
            email: decoded.email || userRecord.email || "",
            roleId: userRecord.roleId,
            companyId: userRecord.companyId,
            franchiseIds: userRecord.franchiseIds || [],
            contractorId: userRecord.contractorId || "",
            accessExpiresAt: userRecord.accessExpiresAt || "",
            accessScope: userRecord.accessScope || "",
            disabled: Boolean(userRecord.disabled),
            permissions: effectivePermissions,
            visibleTabIds: Array.isArray(userRecord.visibleTabIds) ? userRecord.visibleTabIds : [],
            visiblePageIds: Array.isArray(userRecord.visiblePageIds) ? userRecord.visiblePageIds : [],
            sectionOverrides: userRecord.sectionOverrides || {},
            user: userRecord
          }
        };
      } catch (_error) {
        return { ok: false, statusCode: 503, message: "The secure access datastore is temporarily unavailable." };
      }
    } catch (error) {
      return { ok: false, statusCode: 401, message: "Authentication session is invalid or expired." };
    }
  }

  async function requireSession(request, response, next) {
    const sessionResult = await getCurrentSession(request);
    if (!sessionResult.ok) return jsonError(response, sessionResult.statusCode, sessionResult.message);
    if (isBlockedEmail(sessionResult.session.email)) return jsonError(response, 403, "This account has been revoked.");
    if (sessionResult.session.disabled) return jsonError(response, 403, "This account has been disabled.");
    request.osSession = sessionResult.session;
    return next();
  }

  function requireAction(actionName) {
    return async (request, response, next) => {
      const sessionResult = await getCurrentSession(request);
      if (!sessionResult.ok) return jsonError(response, sessionResult.statusCode, sessionResult.message);
      if (isBlockedEmail(sessionResult.session.email)) return jsonError(response, 403, "This account has been revoked.");
      if (sessionResult.session.disabled) return jsonError(response, 403, "This account has been disabled.");
      if (!sessionResult.session.permissions?.actions?.[actionName]) {
        return jsonError(response, 403, "You do not have permission to perform this action.");
      }
      request.osSession = sessionResult.session;
      return next();
    };
  }

  function sessionHasAction(session, actionName) {
    return Boolean(session?.permissions?.actions?.[actionName]);
  }

  function roleRank(roleId) {
    return getSystemRoles().find((role) => role.id === roleId)?.rank || 0;
  }

  function isSuperAdminSession(session) {
    return String(session?.roleId || "") === "super_admin";
  }

  function parseFranchiseIds(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseStringList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function sanitizePermissionsOverride(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const clean = {};
    if (value.tabs && typeof value.tabs === "object" && !Array.isArray(value.tabs)) {
      clean.tabs = {
        mode: value.tabs.mode === "all" ? "all" : "allow",
        allowed: parseStringList(value.tabs.allowed),
        hidden: parseStringList(value.tabs.hidden)
      };
    }
    if (value.pages && typeof value.pages === "object" && !Array.isArray(value.pages)) {
      clean.pages = {
        mode: value.pages.mode === "all" ? "all" : "allow",
        allowed: parseStringList(value.pages.allowed),
        hidden: parseStringList(value.pages.hidden)
      };
    }
    if (value.sections && typeof value.sections === "object" && !Array.isArray(value.sections)) {
      clean.sections = {
        mode: value.sections.mode === "all" ? "all" : "allow",
        allowed: parseStringList(value.sections.allowed),
        hidden: parseStringList(value.sections.hidden)
      };
    }
    if (value.actions && typeof value.actions === "object" && !Array.isArray(value.actions)) {
      clean.actions = Object.fromEntries(
        Object.entries(value.actions).map(([key, enabled]) => [String(key), Boolean(enabled)])
      );
    }
    if (value.dataAccess && typeof value.dataAccess === "object" && !Array.isArray(value.dataAccess)) {
      clean.dataAccess = Object.fromEntries(
        Object.entries(value.dataAccess).map(([key, scope]) => [String(key), String(scope || "none")])
      );
    }
    return clean;
  }

  function applyUserAccessControlFields(target, source = {}) {
    if (Object.prototype.hasOwnProperty.call(source, "permissionsOverride")) {
      target.permissionsOverride = sanitizePermissionsOverride(source.permissionsOverride);
    }
    if (Object.prototype.hasOwnProperty.call(source, "visibleTabIds")) {
      target.visibleTabIds = parseStringList(source.visibleTabIds);
    }
    if (Object.prototype.hasOwnProperty.call(source, "visiblePageIds")) {
      target.visiblePageIds = parseStringList(source.visiblePageIds);
    }
    if (Object.prototype.hasOwnProperty.call(source, "sectionOverrides")) {
      target.sectionOverrides = source.sectionOverrides && typeof source.sectionOverrides === "object" && !Array.isArray(source.sectionOverrides)
        ? source.sectionOverrides
        : {};
    }
    if (Object.prototype.hasOwnProperty.call(source, "assignedJobIds")) {
      target.assignedJobIds = parseStringList(source.assignedJobIds);
    }
    if (Object.prototype.hasOwnProperty.call(source, "assignedTaskIds")) {
      target.assignedTaskIds = parseStringList(source.assignedTaskIds);
    }
    return target;
  }

  function validateRoleAssignment(session, nextRoleId, currentRoleId = "") {
    const roleId = String(nextRoleId || "worker").trim();
    if (!getSystemPermissions()[roleId]) {
      return { ok: false, statusCode: 400, message: "Unknown role requested." };
    }
    if (isSuperAdminSession(session)) return { ok: true };
    if (currentRoleId && roleId === currentRoleId) return { ok: true };
    if (!sessionHasAction(session, "changeRoles")) {
      return roleId === "worker"
        ? { ok: true }
        : { ok: false, statusCode: 403, message: "Changing user roles requires role-management permission." };
    }
    if (roleRank(roleId) >= roleRank(session.roleId)) {
      return { ok: false, statusCode: 403, message: "You cannot assign a role at or above your own access level." };
    }
    return { ok: true };
  }

  function validateUserScope(session, payload, current = {}) {
    if (isSuperAdminSession(session)) return { ok: true };
    const companyId = String(payload.companyId ?? current.companyId ?? session.companyId ?? "").trim();
    if (companyId && session.companyId && companyId !== session.companyId) {
      return { ok: false, statusCode: 403, message: "You can manage users only inside your assigned company." };
    }
    const nextFranchiseIds = Object.prototype.hasOwnProperty.call(payload, "franchiseIds")
      ? parseFranchiseIds(payload.franchiseIds)
      : parseFranchiseIds(current.franchiseIds || session.franchiseIds || []);
    const allowedFranchiseIds = new Set(parseFranchiseIds(session.franchiseIds || []));
    if (nextFranchiseIds.some((id) => !allowedFranchiseIds.has(id))) {
      return { ok: false, statusCode: 403, message: "You can manage users only inside your assigned franchise locations." };
    }
    return { ok: true };
  }

  function scopeOverlaps(session, userRecord = {}) {
    const sessionCompanyId = String(session?.companyId || "").trim();
    const userCompanyId = String(userRecord.companyId || "").trim();
    const sessionFranchiseIds = new Set(parseFranchiseIds(session?.franchiseIds || []));
    const userFranchiseIds = parseFranchiseIds(userRecord.franchiseIds || []);
    const companyScope = session?.permissions?.dataAccess?.company || "none";
    const franchiseScope = session?.permissions?.dataAccess?.franchises || "none";
    const workerScope = session?.permissions?.dataAccess?.workers || "none";
    const sameCompany = Boolean(sessionCompanyId && userCompanyId && sessionCompanyId === userCompanyId);
    const sameFranchise = Boolean(sessionFranchiseIds.size && userFranchiseIds.some((id) => sessionFranchiseIds.has(id)));
    const sameContractor = Boolean(session?.contractorId && userRecord.contractorId && session.contractorId === userRecord.contractorId);

    if (workerScope === "all") return true;
    if (workerScope === "self") return sameContractor;
    if (workerScope !== "assigned") return false;
    if (companyScope === "assigned" && sameCompany) return true;
    if (franchiseScope === "assigned" && sameFranchise) return true;
    return sameContractor;
  }

  function canViewUserRecord(session, userRecord = {}) {
    if (!session || !userRecord) return false;
    if (isSuperAdminSession(session)) return true;
    const sessionEmail = normalizeEmail(session.email);
    const userEmail = normalizeEmail(userRecord.email);
    const isOwnRecord = (session.uid && (session.uid === userRecord.uid || session.uid === userRecord.id))
      || (sessionEmail && userEmail && sessionEmail === userEmail);
    if (isOwnRecord) return true;
    const canManageUsers = sessionHasAction(session, "manageUsers");
    const canInviteWorkers = sessionHasAction(session, "inviteWorkers");
    if (!canManageUsers && !(canInviteWorkers && userRecord.roleId === "worker")) return false;
    if (roleRank(userRecord.roleId) >= roleRank(session.roleId)) return false;
    return scopeOverlaps(session, userRecord);
  }

  function employeeContractorIdForSession(session, requestedContractorId = "") {
    const roleId = String(session?.roleId || "").trim();
    const sessionContractorId = String(session?.contractorId || "").trim();
    if (roleId === "contractor") return sessionContractorId;
    return String(requestedContractorId || sessionContractorId || `employer-${sanitizeEmailKey(session?.email)}`).trim();
  }

  function canViewEmployeeGrant(session, grant = {}) {
    if (sessionHasAction(session, "manageAccessGrants")) return true;
    if (!sessionHasAction(session, "inviteWorkers") || grant.onboardingMode !== "employee_link") return false;
    if (grant.createdByUid && grant.createdByUid === session.uid) return true;
    const sessionContractorId = String(session?.contractorId || "").trim();
    const grantContractorId = String(grant.employerContractorId || grant.contractorId || "").trim();
    if (sessionContractorId && grantContractorId === sessionContractorId) return true;
    const roleId = String(session?.roleId || "").trim();
    if (roleId === "business_owner") {
      return Boolean(session.companyId && grant.companyId === session.companyId);
    }
    if (roleId === "franchise_owner") {
      const allowedFranchises = new Set(parseFranchiseIds(session.franchiseIds || []));
      return parseFranchiseIds(grant.franchiseIds || []).some((id) => allowedFranchises.has(id));
    }
    return false;
  }

  function canViewTicketSignoff(session, signoff = {}) {
    const roleId = String(session?.roleId || "").trim();
    if (roleId === "super_admin") return true;
    const ownIdentity = (session?.uid && signoff.employeeUid === session.uid)
      || (session?.email && normalizeEmail(signoff.employeeEmail) === normalizeEmail(session.email));
    if (roleId === "worker") return ownIdentity;
    if (signoff.employerUid && signoff.employerUid === session?.uid) return true;
    const sessionContractorId = String(session?.contractorId || "").trim();
    const signoffContractorId = String(signoff.employerContractorId || signoff.contractorId || "").trim();
    if (sessionContractorId && signoffContractorId === sessionContractorId) return true;
    if (roleId === "business_owner") {
      return Boolean(session?.companyId && signoff.companyId === session.companyId);
    }
    if (roleId === "franchise_owner") {
      const allowedFranchises = new Set(parseFranchiseIds(session?.franchiseIds || []));
      return parseFranchiseIds(signoff.franchiseIds || []).some((id) => allowedFranchises.has(id));
    }
    return false;
  }

  function normalizeGps(value = {}) {
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    const accuracy = Number(value.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return null;
    }
    return {
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      label: String(value.label || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`).slice(0, 160),
      capturedAt: new Date().toISOString()
    };
  }

  function validateSuperAdminEmailAssignment(roleId, email) {
    if (String(roleId || "").trim() !== "super_admin") return { ok: true };
    if (isSuperAdminEmail(email)) return { ok: true };
    return { ok: false, statusCode: 403, message: "Super Admin access is restricted to david@brothersrestoration.org." };
  }

  function validateSensitiveUserMutation(session, payload, current = {}) {
    const roleRequested = Object.prototype.hasOwnProperty.call(payload, "roleId");
    const nextRoleId = String(roleRequested ? payload.roleId : current.roleId || "worker").trim();
    const roleResult = validateRoleAssignment(session, nextRoleId, current.roleId || "");
    if (!roleResult.ok) return roleResult;

    const disabledRequested = Object.prototype.hasOwnProperty.call(payload, "disabled")
      && Boolean(payload.disabled) !== Boolean(current.disabled);
    if (disabledRequested && !sessionHasAction(session, "disableAccounts")) {
      return { ok: false, statusCode: 403, message: "Disabling or re-enabling users requires account-disable permission." };
    }

    const accessFields = ["accessCode", "accessCodeId", "accessExpiresAt", "accessScope", "portalCodeHash"];
    const accessRequested = accessFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
    if (accessRequested && !sessionHasAction(session, "manageAccessGrants") && !sessionHasAction(session, "issueContractorCodes")) {
      return { ok: false, statusCode: 403, message: "Issuing or changing portal codes requires access-grant permission." };
    }

    const overrideFields = ["permissionsOverride", "visibleTabIds", "visiblePageIds", "sectionOverrides"];
    const overrideRequested = overrideFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== undefined);
    if (overrideRequested && !isSuperAdminSession(session) && !sessionHasAction(session, "manageRolePermissions")) {
      return { ok: false, statusCode: 403, message: "Changing user module visibility requires Super Admin permission." };
    }

    return validateUserScope(session, payload, current);
  }

  function canViewBusinessRecord(session, record) {
    const type = String(record.type || "").trim();
    const actions = session.permissions?.actions || {};
    if (type === "customer" && !actions.viewCustomerDirectory) return false;
    if (type === "revenueInvoice" && !actions.viewRevenueData) return false;
    if (type === "contractorInvoice" && !actions.viewContractorInvoices) return false;

    const scopeKey = type === "customer" ? "customers" : type === "contractorInvoice" ? "contractorInvoices" : "revenue";
    const scope = session.permissions?.dataAccess?.[scopeKey] || "none";
    if (scope === "all") return true;
    if (scope === "assigned") {
      const franchiseIds = new Set(session.franchiseIds || []);
      return record.companyId === session.companyId
        || (record.franchiseId && franchiseIds.has(record.franchiseId))
        || (session.contractorId && record.contractorId === session.contractorId);
    }
    if (scope === "self") {
      return (session.contractorId && record.contractorId === session.contractorId)
        || (record.contractorEmail && normalizeEmail(record.contractorEmail) === normalizeEmail(session.email));
    }
    return false;
  }

  function workspaceCompanyId(session) {
    return String(session?.companyId || "default-company").trim() || "default-company";
  }

  function workspaceRecordReferences(record = {}) {
    return [
      record.id, record.uid, record.jobId, record.job, record.relatedJob,
      record.taskId, record.relatedTask, record.contractorId, record.workerId,
      record.assigneeId, record.assigneeEmail, record.contractorEmail,
      record.workerEmail, record.ownerEmail, record.email
    ]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
  }

  function fieldUserCanAccessWorkspaceRecord(session, field, record = {}) {
    if (!FIELD_USER_EDITABLE_WORKSPACE_FIELDS.has(field)) return false;
    const user = session?.user || {};
    const assignedJobIds = new Set(parseStringList(user.assignedJobIds || []).map((value) => value.toLowerCase()));
    const assignedTaskIds = new Set(parseStringList(user.assignedTaskIds || []).map((value) => value.toLowerCase()));
    const identities = new Set([
      session?.uid, session?.email, session?.contractorId,
      user.id, user.uid, user.email, user.contractorId
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    const references = workspaceRecordReferences(record);
    const assignedReference = references.some((value) => assignedJobIds.has(value) || assignedTaskIds.has(value));
    const identityReference = references.some((value) => identities.has(value));

    if (field === "contractorBills") {
      return String(session?.roleId || "") === "contractor" && identityReference;
    }
    if (field === "files") {
      const sourceType = String(record.sourceType || "").trim().toLowerCase();
      const fileType = String(record.type || "").trim().toLowerCase();
      const isContractorInvoice = sourceType === "contractorinvoice" || fileType === "contractor invoice";
      const isRevenueRecord = ["estimateinvoice", "equipmentinvoice", "paymentrequest"].includes(sourceType)
        || (String(record.moduleKey || "").trim() === "payments" && fileType === "invoice");
      if (isContractorInvoice) {
        return sessionHasAction(session, "viewContractorInvoices") && identityReference;
      }
      if (isRevenueRecord && !sessionHasAction(session, "viewRevenueData")) return false;
    }
    if (field === "tasks") {
      const taskId = String(record.id || record.taskId || "").trim().toLowerCase();
      return (taskId && assignedTaskIds.has(taskId)) || assignedReference || identityReference;
    }
    return assignedReference || identityReference;
  }

  function canAccessWorkspaceRecord(session, field, record = {}, { write = false } = {}) {
    const roleId = String(session?.roleId || "").trim();
    if (roleId === "super_admin" || roleId === "business_owner") return true;
    if (roleId === "franchise_owner") {
      const assignedFranchises = new Set(parseStringList(session?.franchiseIds || []));
      const recordFranchise = String(record.franchiseId || record.branchId || "").trim();
      return Boolean(recordFranchise && assignedFranchises.has(recordFranchise));
    }
    if (write && !sessionHasAction(session, "editAssignedTasks") && field !== "timeEntries" && field !== "photoRecords") {
      return false;
    }
    return fieldUserCanAccessWorkspaceRecord(session, field, record);
  }

  function scopeWorkspaceRecordForWrite(session, record = {}) {
    if (String(session?.roleId || "").trim() !== "franchise_owner") return record;
    if (String(record.franchiseId || record.branchId || "").trim()) return record;
    const assignedFranchises = parseStringList(session?.franchiseIds || []);
    return assignedFranchises.length === 1
      ? { ...record, franchiseId: assignedFranchises[0] }
      : record;
  }

  function canAccessWorkspaceSetting(session) {
    return ["super_admin", "business_owner"].includes(String(session?.roleId || "").trim());
  }

  async function commitWorkspaceOperations(db, operations) {
    for (let index = 0; index < operations.length; index += WORKSPACE_BATCH_SIZE) {
      const batch = db.batch();
      operations.slice(index, index + WORKSPACE_BATCH_SIZE).forEach((operation) => {
        batch.set(operation.ref, operation.data, { merge: operation.merge !== false });
      });
      await batch.commit();
    }
  }

  async function readWorkspaceState(session) {
    const db = getFirestore();
    const companyId = workspaceCompanyId(session);
    const [recordSnapshot, settingSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.workspaceRecords).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.workspaceSettings).where("companyId", "==", companyId).get()
    ]);
    const workspaceState = {};
    const recordsByField = new Map();
    let latestUpdatedAt = "";

    recordSnapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      if (stored.deletedAt || !WORKSPACE_ARRAY_FIELD_SET.has(stored.field)) return;
      const data = cleanWorkspaceValue(stored.data || {});
      if (!canAccessWorkspaceRecord(session, stored.field, data)) return;
      if (!recordsByField.has(stored.field)) recordsByField.set(stored.field, []);
      recordsByField.get(stored.field).push({
        sortIndex: Number(stored.sortIndex || 0),
        data
      });
      if (String(stored.updatedAt || "") > latestUpdatedAt) latestUpdatedAt = String(stored.updatedAt || "");
    });
    recordsByField.forEach((records, field) => {
      workspaceState[field] = records
        .sort((left, right) => left.sortIndex - right.sortIndex)
        .map((record) => record.data);
    });

    if (canAccessWorkspaceSetting(session)) {
      settingSnapshot.docs.forEach((doc) => {
        const stored = doc.data() || {};
        if (stored.deletedAt || !WORKSPACE_SETTING_FIELD_SET.has(stored.field)) return;
        workspaceState[stored.field] = cleanWorkspaceValue(stored.value, stored.field);
        if (String(stored.updatedAt || "") > latestUpdatedAt) latestUpdatedAt = String(stored.updatedAt || "");
      });
    }

    return {
      workspaceState,
      exists: recordSnapshot.docs.some((doc) => !doc.data()?.deletedAt)
        || settingSnapshot.docs.some((doc) => !doc.data()?.deletedAt),
      recordCount: Array.from(recordsByField.values()).reduce((sum, records) => sum + records.length, 0),
      updatedAt: latestUpdatedAt
    };
  }

  async function writeWorkspaceState(session, input = {}) {
    const db = getFirestore();
    const companyId = workspaceCompanyId(session);
    if (Buffer.byteLength(JSON.stringify(input || {})) > WORKSPACE_MAX_REQUEST_BYTES) {
      const error = new Error("Workspace update is too large. Upload files separately and keep the workspace payload under 3 MB.");
      error.statusCode = 413;
      throw error;
    }
    const now = new Date().toISOString();
    const operations = [];
    const incomingDocumentIds = new Set();
    const fieldsWithIgnoredRecords = new Set();
    let savedRecords = 0;
    let ignoredRecords = 0;
    const roleId = String(session?.roleId || "").trim();
    const canDeleteWorkspaceRecords = ["super_admin", "business_owner", "franchise_owner"].includes(roleId);
    const existingSnapshot = canDeleteWorkspaceRecords
      ? await db.collection(COLLECTIONS.workspaceRecords).where("companyId", "==", companyId).get()
      : null;

    for (const field of WORKSPACE_ARRAY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      const records = Array.isArray(input[field]) ? input[field].slice(0, WORKSPACE_MAX_RECORDS_PER_FIELD) : [];
      records.forEach((rawRecord, sortIndex) => {
        const cleanedData = cleanWorkspaceValue(rawRecord);
        if (!cleanedData || typeof cleanedData !== "object" || Array.isArray(cleanedData)) {
          ignoredRecords += 1;
          fieldsWithIgnoredRecords.add(field);
          return;
        }
        const data = scopeWorkspaceRecordForWrite(session, cleanedData);
        if (!canAccessWorkspaceRecord(session, field, data, { write: true })) {
          ignoredRecords += 1;
          fieldsWithIgnoredRecords.add(field);
          return;
        }
        const recordId = workspaceRecordId(field, data, sortIndex);
        const documentId = workspaceDocumentId(companyId, field, recordId, data);
        incomingDocumentIds.add(documentId);
        operations.push({
          ref: db.collection(COLLECTIONS.workspaceRecords).doc(documentId),
          data: {
            companyId,
            field,
            recordId,
            data,
            sortIndex,
            deletedAt: "",
            updatedAt: now,
            updatedByUid: session.uid,
            updatedByEmail: session.email
          }
        });
        savedRecords += 1;
      });
    }

    if (canAccessWorkspaceSetting(session)) {
      for (const field of WORKSPACE_SETTING_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
        const value = cleanWorkspaceValue(input[field], field);
        operations.push({
          ref: db.collection(COLLECTIONS.workspaceSettings).doc(workspaceSettingDocumentId(companyId, field)),
          data: {
            companyId,
            field,
            value,
            deletedAt: "",
            updatedAt: now,
            updatedByUid: session.uid,
            updatedByEmail: session.email
          }
        });
      }
    }

    if (existingSnapshot) {
      existingSnapshot.docs.forEach((doc) => {
        const stored = doc.data() || {};
        if (!WORKSPACE_ARRAY_FIELD_SET.has(stored.field)) return;
        if (!Object.prototype.hasOwnProperty.call(input, stored.field)) return;
        if (fieldsWithIgnoredRecords.has(stored.field)) return;
        if (incomingDocumentIds.has(doc.id) || stored.deletedAt) return;
        if (!canAccessWorkspaceRecord(session, stored.field, stored.data || {}, { write: true })) return;
        operations.push({
          ref: db.collection(COLLECTIONS.workspaceRecords).doc(doc.id),
          data: {
            deletedAt: now,
            updatedAt: now,
            updatedByUid: session.uid,
            updatedByEmail: session.email
          }
        });
      });
    }

    await commitWorkspaceOperations(db, operations);
    return {
      savedRecords,
      ignoredRecords,
      updatedAt: now
    };
  }

  function firebaseAdminDataStoreConfigured() {
    return Boolean(getFirestore());
  }

  function adminDataStoreRequired(response) {
    return jsonError(response, 503, "Firebase admin credentials are required for persistent user management, invite links, access codes, and communication-board writes.");
  }

  async function saveWorkspaceAsset(session, input = {}) {
    const db = getFirestore();
    const bucket = typeof getFirebaseStorageBucket === "function" ? getFirebaseStorageBucket() : null;
    if (!db || !bucket) {
      const error = new Error("Firebase Storage is required before files can be uploaded.");
      error.statusCode = 503;
      throw error;
    }
    const fileName = String(input.fileName || "upload").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160);
    const contentType = String(input.contentType || "application/octet-stream").toLowerCase();
    const allowedContentTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf"
    ]);
    if (!allowedContentTypes.has(contentType)) {
      const error = new Error("Upload a JPEG, PNG, WebP, HEIC, or PDF file.");
      error.statusCode = 400;
      throw error;
    }
    const base64 = String(input.base64 || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
      const error = new Error("Uploaded files must be between 1 byte and 3 MB.");
      error.statusCode = 413;
      throw error;
    }
    const scopeRecord = {
      jobId: String(input.jobId || "").trim(),
      taskId: String(input.taskId || "").trim(),
      contractorId: session.contractorId || "",
      contractorEmail: session.email || "",
      workerId: session.uid || "",
      workerEmail: session.email || ""
    };
    if (!canAccessWorkspaceRecord(session, "photoRecords", scopeRecord, { write: true })) {
      const error = new Error("You can upload files only for your assigned jobs and tasks.");
      error.statusCode = 403;
      throw error;
    }
    const assetId = crypto.randomUUID();
    const companyId = workspaceCompanyId(session);
    const objectPath = `os-workspace/${companyId}/${assetId}-${fileName}`;
    await bucket.file(objectPath).save(buffer, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: "private, max-age=300",
        metadata: {
          assetId,
          companyId,
          uploadedByUid: session.uid,
          uploadedByEmail: session.email
        }
      }
    });
    const now = new Date().toISOString();
    const asset = {
      id: assetId,
      companyId,
      objectPath,
      fileName,
      contentType,
      size: buffer.length,
      jobId: scopeRecord.jobId,
      taskId: scopeRecord.taskId,
      contractorId: scopeRecord.contractorId,
      contractorEmail: scopeRecord.contractorEmail,
      workerId: scopeRecord.workerId,
      workerEmail: scopeRecord.workerEmail,
      createdByUid: session.uid,
      createdByEmail: session.email,
      createdAt: now,
      updatedAt: now
    };
    await db.collection(COLLECTIONS.workspaceAssets).doc(assetId).set(asset);
    return {
      ...asset,
      objectPath: undefined,
      assetUrl: `/api/workspace-assets/${encodeURIComponent(assetId)}`
    };
  }

  function buildFallbackSuperAdminSession(decodedToken, accessExpiresAt = "") {
    const email = normalizeEmail(decodedToken.email);
    const authUser = {
      uid: decodedToken.uid,
      email,
      displayName: decodedToken.name || email,
      disabled: false
    };
    const user = normalizeUserRecord(decodedToken.uid, authUser, {
      roleId: "super_admin",
      disabled: false,
      status: "active",
      accessScope: "owner_rest_auth",
      accessExpiresAt: accessExpiresAt || hoursFromNow(1)
    });
    return {
      uid: user.uid,
      email: user.email,
      roleId: user.roleId,
      companyId: user.companyId,
      franchiseIds: user.franchiseIds || [],
      contractorId: user.contractorId || "",
      accessExpiresAt: user.accessExpiresAt || "",
      accessScope: user.accessScope || "",
      disabled: false,
      permissions: buildEffectivePermissions("super_admin", {}),
      user
    };
  }

  function recentAuthenticationResult(decodedToken) {
    const authTimeSeconds = Number(decodedToken?.auth_time || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authTimeSeconds) || authTimeSeconds <= 0 || nowSeconds - authTimeSeconds > 5 * 60) {
      return {
        ok: false,
        statusCode: 401,
        message: "For security, sign in with Google again before starting a new Brothers OS session."
      };
    }
    return { ok: true };
  }

  function fallbackSessionDurationMs(decodedToken) {
    const tokenExpiresAtMs = Number(decodedToken?.exp || 0) * 1000;
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= Date.now()) return 0;
    return Math.max(0, Math.min(getSessionTtlMs(), tokenExpiresAtMs - Date.now()));
  }

  function buildFallbackAccessContext(session) {
    const seeds = buildSeedTabsPagesSections();
    const permissionDocs = Object.entries(getSystemPermissions()).map(([roleId, permissions]) => ({
      roleId,
      ...permissions,
      updatedAt: new Date().toISOString()
    }));
    const businessData = getDefaultBusinessRecords().filter((record) => canViewBusinessRecord(session, record));
    const communityPosts = [
      {
        id: "owner-readiness-board",
        title: "Brothers OS launch board",
        body: "Owner-only Google sign-in is active. Configure Firebase admin credentials in Vercel to persist invite links, contractor access codes, user edits, and board posts.",
        tags: ["launch", "admin"],
        visibility: "contractors",
        authorEmail: "david@brothersrestoration.org",
        authorRoleId: "super_admin",
        comments: [],
        pinned: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    return {
      user: publicUserRecord(session.user),
      session: {
        uid: session.uid,
        email: session.email,
        roleId: session.roleId,
        companyId: session.companyId,
        franchiseIds: session.franchiseIds,
        contractorId: session.contractorId || "",
        accessExpiresAt: session.accessExpiresAt || "",
        accessScope: session.accessScope || "",
        permissions: session.permissions,
        visibleTabIds: session.visibleTabIds || [],
        visiblePageIds: session.visiblePageIds || []
      },
      roles: getSystemRoles(),
      permissions: permissionDocs,
      tabs: filterCollectionByPermission(seeds.tabs, session.permissions, "tabs", "id", session.visibleTabIds || session.user?.visibleTabIds || []),
      pages: filterCollectionByPermission(seeds.pages, session.permissions, "pages", "id", session.visiblePageIds || session.user?.visiblePageIds || []),
      pageSections: filterCollectionByPermission(seeds.sections, session.permissions, "sections"),
      companySettings: getDefaultCompanySettings(),
      franchiseSettings: [getDefaultFranchiseSettings()],
      users: [publicUserRecord(session.user)],
      auditLogs: [],
      businessData,
      accessRequests: [],
      accessGrants: [],
      ticketSignoffs: [],
      communityPosts
    };
  }

  async function buildAccessContext(session) {
    if (!firebaseAdminDataStoreConfigured()) {
      return buildFallbackAccessContext(session);
    }
    const db = getFirestore();
    await seedDefaults(db);
    const canReadBusinessData = session.permissions?.actions?.viewCustomerDirectory
      || session.permissions?.actions?.viewRevenueData
      || session.permissions?.actions?.viewContractorInvoices;
    const canManageAccess = session.permissions?.actions?.manageAccessGrants;
    const canInviteWorkers = session.permissions?.actions?.inviteWorkers;
    const canUseCommunity = session.permissions?.actions?.postCommunityMessages;
    const [tabsSnapshot, pagesSnapshot, sectionsSnapshot, companySnapshot, rolesSnapshot, permissionsSnapshot, franchiseSnapshot, usersSnapshot, auditSnapshot, businessSnapshot, accessRequestsSnapshot, accessGrantsSnapshot, ticketSignoffsSnapshot, communitySnapshot] = await Promise.all([
      db.collection(COLLECTIONS.tabs).orderBy("order").get(),
      db.collection(COLLECTIONS.pages).orderBy("order").get(),
      db.collection(COLLECTIONS.pageSections).get(),
      db.collection(COLLECTIONS.companySettings).doc("default").get(),
      db.collection(COLLECTIONS.roles).orderBy("rank", "desc").get(),
      db.collection(COLLECTIONS.permissions).get(),
      session.companyId ? db.collection(COLLECTIONS.franchiseSettings).get() : Promise.resolve({ docs: [] }),
      session.permissions?.actions?.manageUsers || canInviteWorkers ? db.collection(COLLECTIONS.users).get() : Promise.resolve({ docs: [] }),
      session.permissions?.actions?.viewAuditLogs ? db.collection(COLLECTIONS.auditLogs).orderBy("createdAt", "desc").limit(200).get() : Promise.resolve({ docs: [] }),
      canReadBusinessData ? db.collection(COLLECTIONS.businessRecords).get() : Promise.resolve({ docs: [] }),
      canManageAccess ? db.collection(COLLECTIONS.accessRequests).orderBy("requestedAt", "desc").limit(100).get() : Promise.resolve({ docs: [] }),
      canManageAccess || canInviteWorkers ? db.collection(COLLECTIONS.accessGrants).orderBy("createdAt", "desc").limit(100).get() : Promise.resolve({ docs: [] }),
      db.collection(COLLECTIONS.employeeTicketSignoffs).orderBy("signedAt", "desc").limit(250).get(),
      canUseCommunity ? db.collection(COLLECTIONS.communityPosts).orderBy("createdAt", "desc").limit(100).get() : Promise.resolve({ docs: [] })
    ]);

    const tabs = filterCollectionByPermission(
      tabsSnapshot.docs.map((doc) => doc.data()).filter((tab) => tab.visible !== false),
      session.permissions,
      "tabs",
      "id",
      session.visibleTabIds || session.user?.visibleTabIds || []
    );
    const pages = filterCollectionByPermission(
      pagesSnapshot.docs.map((doc) => doc.data()).filter((page) => page.visible !== false),
      session.permissions,
      "pages",
      "id",
      session.visiblePageIds || session.user?.visiblePageIds || []
    );
    const visiblePageIds = new Set(pages.map((page) => page.id));
    const sections = filterCollectionByPermission(
      sectionsSnapshot.docs
        .map((doc) => doc.data())
        .filter((section) => visiblePageIds.has(section.pageId) && section.visible !== false)
        .sort((left, right) => String(left.pageId || "").localeCompare(String(right.pageId || ""))
          || Number(left.order || 0) - Number(right.order || 0)),
      session.permissions,
      "sections"
    );

    return {
      user: publicUserRecord(session.user),
      session: {
        uid: session.uid,
        email: session.email,
        roleId: session.roleId,
        companyId: session.companyId,
        franchiseIds: session.franchiseIds,
        contractorId: session.contractorId || "",
        accessExpiresAt: session.accessExpiresAt || "",
        accessScope: session.accessScope || "",
        permissions: session.permissions,
        visibleTabIds: session.visibleTabIds || session.user?.visibleTabIds || [],
        visiblePageIds: session.visiblePageIds || session.user?.visiblePageIds || []
      },
      roles: rolesSnapshot.docs.map((doc) => doc.data()),
      permissions: permissionsSnapshot.docs.map((doc) => doc.data()),
      tabs,
      pages,
      pageSections: sections,
      companySettings: companySnapshot.exists ? companySnapshot.data() : getDefaultCompanySettings(),
      franchiseSettings: franchiseSnapshot.docs.map((doc) => doc.data()),
      users: usersSnapshot.docs
        .map((doc) => normalizeUserRecord(doc.id, null, doc.data()))
        .filter((user) => canViewUserRecord(session, user))
        .map(publicUserRecord),
      auditLogs: auditSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      businessData: businessSnapshot.docs.map(docDataWithId).filter((record) => canViewBusinessRecord(session, record)),
      accessRequests: accessRequestsSnapshot.docs.map(docDataWithId),
      accessGrants: accessGrantsSnapshot.docs
        .map(docDataWithId)
        .filter((grant) => canViewEmployeeGrant(session, grant))
        .map((grant) => {
          delete grant.tokenHash;
          delete grant.portalCodeHash;
          return grant;
        }),
      ticketSignoffs: ticketSignoffsSnapshot.docs.map(docDataWithId).filter((signoff) => canViewTicketSignoff(session, signoff)),
      communityPosts: communitySnapshot.docs.map(docDataWithId)
    };
  }

  router.get("/api/auth/config", (_request, response) => {
    const firebasePublicConfig = getFirebasePublicConfig();
    const sessionTtlMs = firebasePublicConfig.adminConfigured
      ? getSessionTtlMs()
      : Math.min(getSessionTtlMs(), 60 * 60 * 1000);
    return response.json({
      success: true,
      firebase: {
        ...firebasePublicConfig,
        allowedSignInProviders: Array.from(getAllowedSignInProviders()),
        ownerOnlyLogin: isOwnerOnlyLoginEnabled(),
        allowedLoginEmails: Array.from(getAllowedLoginEmails()),
        sessionTtlMs,
        sessionTtlHours: Math.round(sessionTtlMs / 60 / 60 / 100) / 10,
        requiresVerifiedEmail: true,
        inviteEmailConfigured: inviteEmailConfigured()
      }
    });
  });

  router.post("/api/auth/session/login", async (request, response) => {
    if (!isFirebaseConfigured()) {
      return jsonError(response, 503, "Firebase authentication is not configured.");
    }
    const idToken = String(request.body?.idToken || "").trim();
    if (!idToken) return jsonError(response, 400, "A Firebase ID token is required.");

    try {
      const auth = getFirebaseAuth();
      const decoded = await auth.verifyIdToken(idToken, true);
      const providerResult = assertAllowedProvider(decoded);
      if (!providerResult.ok) return jsonError(response, providerResult.statusCode, providerResult.message);
      const recentAuth = recentAuthenticationResult(decoded);
      if (!recentAuth.ok) return jsonError(response, recentAuth.statusCode, recentAuth.message);
      if (!firebaseAdminDataStoreConfigured()) {
        if (!isOwnerOnlyLoginEnabled()) {
          return jsonError(response, 503, "Firebase Admin credentials are required before owner-only login can be opened to additional users.");
        }
        const emailResult = assertFallbackSuperAdminEmail(decoded.email, decoded.uid);
        if (!emailResult.ok) return jsonError(response, emailResult.statusCode, emailResult.message);
        const expiresIn = fallbackSessionDurationMs(decoded);
        if (!expiresIn) return jsonError(response, 401, "Firebase Google token is expired.");
        const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
        response.cookie(sessionCookieName, sessionCookie, getCookieOptions(request, expiresIn));
        const session = buildFallbackSuperAdminSession(decoded, new Date(Date.now() + expiresIn).toISOString());
        return response.json({
          success: true,
          session: {
            uid: session.uid,
            email: session.email,
            roleId: session.roleId,
            companyId: session.companyId,
            franchiseIds: session.franchiseIds || [],
            contractorId: session.contractorId || "",
            accessExpiresAt: session.accessExpiresAt || "",
            accessScope: session.accessScope || "",
            visibleTabIds: session.visibleTabIds || session.user?.visibleTabIds || [],
            visiblePageIds: session.visiblePageIds || session.user?.visiblePageIds || []
          }
        });
      }
      const ensured = await ensureUserRecord(decoded, {
        accessToken: String(request.body?.accessToken || "").trim(),
        accessCode: String(request.body?.accessCode || "").trim()
      });
      const userRecord = ensured.record || ensured;
      const accessResult = await assertSessionAccess(userRecord, {
        accessCode: String(request.body?.accessCode || "").trim(),
        grant: ensured.grant || null
      });
      if (!accessResult.ok) return jsonError(response, accessResult.statusCode, accessResult.message);
      if (ensured.grant?.id) {
        await activateAccessGrant(
          decoded,
          userRecord,
          ensured.grant,
          String(request.body?.accessToken || "").trim()
        );
      }
      const expiresIn = getSessionTtlMs();
      const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
      response.cookie(sessionCookieName, sessionCookie, getCookieOptions(request, expiresIn));
      return response.json({
        success: true,
        session: {
          uid: decoded.uid,
          email: decoded.email || userRecord.email,
          roleId: userRecord.roleId,
          companyId: userRecord.companyId,
          franchiseIds: userRecord.franchiseIds || [],
          contractorId: userRecord.contractorId || "",
          accessExpiresAt: userRecord.accessExpiresAt || "",
          accessScope: userRecord.accessScope || "",
          visibleTabIds: userRecord.visibleTabIds || [],
          visiblePageIds: userRecord.visiblePageIds || []
        }
      });
    } catch (error) {
      const adminConfigured = Boolean(getFirebasePublicConfig()?.adminConfigured);
      const statusCode = Number(error?.statusCode || (adminConfigured ? 503 : 401));
      return jsonError(response, statusCode, error.message || (statusCode === 503
        ? "The secure access datastore is temporarily unavailable."
        : "Unable to establish a Firebase session."));
    }
  });

  router.post("/api/auth/session/logout", async (request, response) => {
    const sessionResult = await getCurrentSession(request);
    if (sessionResult.ok && isFirebaseConfigured()) {
      try {
        await getFirebaseAuth().revokeRefreshTokens(sessionResult.session.uid);
      } catch (_error) {
      }
    }
    response.clearCookie(sessionCookieName, {
      ...getCookieOptions(request, 0),
      maxAge: undefined
    });
    return response.json({ success: true });
  });

  router.get("/api/auth/session", requireSession, async (request, response) => {
    try {
      const context = await buildAccessContext(request.osSession);
      return response.json({ success: true, contextStatus: "ready", ...context });
    } catch (error) {
      console.error("Brothers OS access context could not be hydrated.", error);
      const fallbackContext = buildFallbackAccessContext(request.osSession);
      return response.json({
        success: true,
        contextStatus: "degraded",
        contextMessage: "Your secure session is active, but live workspace configuration is temporarily unavailable.",
        ...fallbackContext
      });
    }
  });

  router.post("/api/access/trial-request", async (request, response) => {
    if (!isFirebaseConfigured()) {
      return jsonError(response, 503, "Firebase authentication is not configured.");
    }
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const email = normalizeEmail(request.body?.email);
    const displayName = String(request.body?.displayName || request.body?.name || "").trim();
    const companyName = String(request.body?.companyName || "").trim();
    const requestedRole = String(request.body?.roleId || "contractor").trim();
    if (!email || !email.includes("@")) return jsonError(response, 400, "A valid email is required.");
    const superAdminRequest = validateSuperAdminEmailAssignment(requestedRole, email);
    if (!superAdminRequest.ok) return jsonError(response, superAdminRequest.statusCode, superAdminRequest.message);

    const requestDoc = {
      email,
      displayName,
      companyName,
      requestedRole,
      status: "requested",
      requestedAt: new Date().toISOString(),
      expiresAt: hoursFromNow(48),
      requestIp: request.ip || "",
      userAgent: String(request.get("user-agent") || "").slice(0, 240)
    };
    const docRef = await db.collection(COLLECTIONS.accessRequests).add(requestDoc);
    return response.status(201).json({
      success: true,
      request: { id: docRef.id, ...requestDoc },
      message: "Access request received. A Super Admin must approve it and issue the 48-hour link and access code."
    });
  });

  router.get("/api/access/requests", requireAction("manageAccessGrants"), async (_request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return response.json({ success: true, accessRequests: [] });
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.accessRequests).orderBy("requestedAt", "desc").limit(100).get();
    return response.json({ success: true, accessRequests: snapshot.docs.map(docDataWithId) });
  });

  router.post("/api/access/grants", requireAction("manageAccessGrants"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const email = normalizeEmail(request.body?.email);
    if (!email || !email.includes("@")) return jsonError(response, 400, "A valid email is required.");
    const roleId = String(request.body?.roleId || "contractor").trim();
    const superAdminRequest = validateSuperAdminEmailAssignment(roleId, email);
    if (!superAdminRequest.ok) return jsonError(response, superAdminRequest.statusCode, superAdminRequest.message);
    const ttlHours = clampAccessHours(request.body?.ttlHours);
    const token = createToken();
    const accessCode = createAccessCode(roleId);
    const now = new Date().toISOString();
    const accessCodeId = `code-${crypto.randomBytes(4).toString("hex")}`;
    const grant = {
      email,
      displayName: String(request.body?.displayName || email).trim(),
      roleId,
      companyId: String(request.body?.companyId || "default-company").trim(),
      franchiseIds: Array.isArray(request.body?.franchiseIds) ? request.body.franchiseIds : String(request.body?.franchiseIds || "").split(",").map((item) => item.trim()).filter(Boolean),
      contractorId: String(request.body?.contractorId || `contractor-${sanitizeEmailKey(email)}`).trim(),
      accessScope: "48_hour_access",
      status: "issued",
      tokenHash: hashSecret(token),
      portalCodeHash: hashPortalCode(accessCode),
      accessCodeId,
      failedCodeAttempts: 0,
      codeLockedUntil: "",
      expiresAt: hoursFromNow(ttlHours),
      createdAt: now,
      updatedAt: now,
      createdByUid: request.osSession.uid,
      createdByEmail: request.osSession.email,
      requestId: String(request.body?.requestId || "").trim()
    };
    applyUserAccessControlFields(grant, request.body || {});
    const mutationResult = validateSensitiveUserMutation(request.osSession, {
      roleId,
      companyId: grant.companyId,
      franchiseIds: grant.franchiseIds,
      contractorId: grant.contractorId,
      accessExpiresAt: grant.expiresAt,
      accessScope: grant.accessScope,
      permissionsOverride: grant.permissionsOverride,
      visibleTabIds: grant.visibleTabIds,
      visiblePageIds: grant.visiblePageIds,
      sectionOverrides: grant.sectionOverrides
    });
    if (!mutationResult.ok) return jsonError(response, mutationResult.statusCode, mutationResult.message);
    const grantRef = await db.collection(COLLECTIONS.accessGrants).add(grant);
    const accessLink = buildAccessLink(request, token);
    const shouldSendEmail = request.body?.sendEmail !== false;
    let emailDelivery = { status: shouldSendEmail ? "pending" : "skipped" };
    if (shouldSendEmail) {
      emailDelivery = await sendAccessInviteEmail({
        email,
        displayName: grant.displayName,
        roleId,
        accessCode,
        accessLink,
        expiresAt: grant.expiresAt,
        createdByEmail: request.osSession.email
      });
      await db.collection(COLLECTIONS.accessGrants).doc(grantRef.id).set({
        emailDelivery,
        emailedAt: emailDelivery.status === "sent" ? new Date().toISOString() : "",
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
    if (grant.requestId) {
      await db.collection(COLLECTIONS.accessRequests).doc(grant.requestId).set({
        status: "approved",
        grantId: grantRef.id,
        approvedAt: now,
        approvedByUid: request.osSession.uid
      }, { merge: true });
    }
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "access_grant_issued",
      targetType: "access_grant",
      targetId: grantRef.id,
      metadata: { email, roleId, expiresAt: grant.expiresAt, emailDelivery }
    });
    const publicGrant = { id: grantRef.id, ...grant, emailDelivery };
    delete publicGrant.tokenHash;
    delete publicGrant.portalCodeHash;
    return response.status(201).json({
      success: true,
      grant: publicGrant,
      accessCode,
      accessLink,
      emailDelivery
    });
  });

  router.post("/api/employee-invitations", requireAction("inviteWorkers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const email = normalizeEmail(request.body?.email);
    if (!email || !email.includes("@")) return jsonError(response, 400, "A valid employee Google email is required.");
    if (isBlockedEmail(email) || isSuperAdminEmail(email)) {
      return jsonError(response, 403, "This email cannot be enrolled as an employee.");
    }

    const roleId = String(request.osSession.roleId || "").trim();
    const contractorId = employeeContractorIdForSession(request.osSession, request.body?.contractorId);
    if (!contractorId) {
      return jsonError(response, 400, "A contractor profile is required before employees can be invited.");
    }
    if (roleId === "contractor" && contractorId !== String(request.osSession.contractorId || "").trim()) {
      return jsonError(response, 403, "Contractors can invite employees only to their own profile.");
    }

    const companyId = isSuperAdminSession(request.osSession)
      ? String(request.body?.companyId || request.osSession.companyId || "default-company").trim()
      : String(request.osSession.companyId || "default-company").trim();
    const requestedFranchiseIds = parseFranchiseIds(request.body?.franchiseIds);
    const franchiseIds = isSuperAdminSession(request.osSession)
      ? requestedFranchiseIds
      : requestedFranchiseIds.length
        ? requestedFranchiseIds
        : parseFranchiseIds(request.osSession.franchiseIds || []);
    const scopeResult = validateUserScope(request.osSession, { companyId, franchiseIds });
    if (!scopeResult.ok) return jsonError(response, scopeResult.statusCode, scopeResult.message);

    const existingUsers = await db.collection(COLLECTIONS.users).where("email", "==", email).get();
    const existingActiveUser = existingUsers.docs
      .map((doc) => normalizeUserRecord(doc.id, null, doc.data()))
      .find((user) => !user.disabled && user.status === "active");
    if (existingActiveUser) {
      if (existingActiveUser.roleId !== "worker" || existingActiveUser.contractorId !== contractorId) {
        return jsonError(response, 409, "This Google email already belongs to a different active platform account.");
      }
      return jsonError(response, 409, "This employee already has an active portal account. Update assignments from the employee profile.");
    }

    const workerPermissions = getSystemPermissions().worker;
    const allowedModules = new Set(workerPermissions.pages?.allowed || []);
    const requestedModules = parseStringList(
      request.body?.visiblePageIds || request.body?.visibleTabIds || request.body?.visibleModuleKeys
    ).filter((moduleKey) => allowedModules.has(moduleKey));
    const visibleModuleIds = requestedModules.length ? requestedModules : Array.from(allowedModules);
    const token = createToken();
    const now = new Date().toISOString();
    const grant = {
      email,
      displayName: String(request.body?.displayName || email).trim(),
      roleId: "worker",
      companyId,
      franchiseIds,
      contractorId,
      employerUid: request.osSession.uid,
      employerEmail: normalizeEmail(request.osSession.email),
      employerContractorId: contractorId,
      onboardingMode: "employee_link",
      employmentStatus: "invited",
      accessScope: "employee_portal",
      status: "issued",
      tokenHash: hashSecret(token),
      portalCodeHash: "",
      accessCodeId: "",
      failedCodeAttempts: 0,
      codeLockedUntil: "",
      expiresAt: hoursFromNow(48),
      createdAt: now,
      updatedAt: now,
      createdByUid: request.osSession.uid,
      createdByEmail: request.osSession.email,
      visibleTabIds: visibleModuleIds,
      visiblePageIds: visibleModuleIds,
      assignedJobIds: parseStringList(request.body?.assignedJobIds),
      assignedTaskIds: parseStringList(request.body?.assignedTaskIds),
      jobTitle: String(request.body?.jobTitle || "Field employee").trim().slice(0, 120)
    };

    const olderGrants = await db.collection(COLLECTIONS.accessGrants).where("email", "==", email).get();
    for (const doc of olderGrants.docs) {
      const current = doc.data() || {};
      if (current.onboardingMode === "employee_link" && current.status === "issued") {
        await db.collection(COLLECTIONS.accessGrants).doc(doc.id).set({
          status: "superseded",
          tokenHash: "",
          updatedAt: now,
          supersededByUid: request.osSession.uid
        }, { merge: true });
      }
    }

    const grantRef = await db.collection(COLLECTIONS.accessGrants).add(grant);
    const accessLink = buildAccessLink(request, token, grant.onboardingMode);
    const shouldSendEmail = request.body?.sendEmail !== false;
    let emailDelivery = { status: shouldSendEmail ? "pending" : "skipped" };
    if (shouldSendEmail) {
      emailDelivery = await sendAccessInviteEmail({
        email,
        displayName: grant.displayName,
        roleId: "worker",
        accessCode: "",
        accessLink,
        expiresAt: grant.expiresAt,
        createdByEmail: request.osSession.email,
        onboardingMode: grant.onboardingMode
      });
      await db.collection(COLLECTIONS.accessGrants).doc(grantRef.id).set({
        emailDelivery,
        emailedAt: emailDelivery.status === "sent" ? new Date().toISOString() : "",
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_invitation_issued",
      targetType: "access_grant",
      targetId: grantRef.id,
      metadata: { email, contractorId, companyId, franchiseIds, expiresAt: grant.expiresAt, emailDelivery }
    });
    const publicGrant = { id: grantRef.id, ...grant, emailDelivery };
    delete publicGrant.tokenHash;
    delete publicGrant.portalCodeHash;
    return response.status(201).json({ success: true, grant: publicGrant, accessLink, emailDelivery });
  });

  router.patch("/api/employees/:uid/assignments", requireAction("inviteWorkers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const uid = String(request.params.uid || "").trim();
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "Employee account not found.");
    const employee = normalizeUserRecord(uid, null, snapshot.data());
    if (employee.roleId !== "worker" || !canViewUserRecord(request.osSession, employee)) {
      return jsonError(response, 403, "You can update only employees assigned to your contractor profile.");
    }
    const updates = {
      assignedJobIds: parseStringList(request.body?.assignedJobIds),
      assignedTaskIds: parseStringList(request.body?.assignedTaskIds),
      updatedAt: new Date().toISOString()
    };
    await userRef.set(updates, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_assignments_updated",
      targetType: "user",
      targetId: uid,
      metadata: updates
    });
    return response.json({ success: true, user: publicUserRecord({ ...employee, ...updates }) });
  });

  router.patch("/api/employee/profile", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    if (request.osSession.roleId !== "worker") {
      return jsonError(response, 403, "Only an employee can update this employee profile.");
    }
    const updates = {
      phone: String(request.body?.phone || "").trim().slice(0, 40),
      jobTitle: String(request.body?.jobTitle || "").trim().slice(0, 120),
      employmentStatus: "active",
      onboardingAcceptedAt: request.osSession.user?.onboardingAcceptedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const db = getFirestore();
    await db.collection(COLLECTIONS.users).doc(request.osSession.uid).set(updates, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_profile_updated",
      targetType: "user",
      targetId: request.osSession.uid,
      metadata: { phoneProvided: Boolean(updates.phone), jobTitle: updates.jobTitle }
    });
    return response.json({ success: true, user: publicUserRecord({ ...request.osSession.user, ...updates }) });
  });

  router.get("/api/employee/ticket-signoffs", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return response.json({ success: true, ticketSignoffs: [] });
    const snapshot = await getFirestore().collection(COLLECTIONS.employeeTicketSignoffs)
      .orderBy("signedAt", "desc")
      .limit(250)
      .get();
    return response.json({
      success: true,
      ticketSignoffs: snapshot.docs.map(docDataWithId).filter((signoff) => canViewTicketSignoff(request.osSession, signoff))
    });
  });

  router.post("/api/employee/ticket-signoffs", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    if (request.osSession.roleId !== "worker") {
      return jsonError(response, 403, "Only the assigned employee can sign off a work ticket.");
    }
    const taskId = String(request.body?.taskId || "").trim();
    const typedSignature = String(request.body?.typedSignature || "").trim().slice(0, 120);
    const attested = request.body?.attested === true;
    const gps = normalizeGps(request.body?.gps);
    if (!taskId) return jsonError(response, 400, "Choose an assigned ticket before signing.");
    if (typedSignature.length < 2) return jsonError(response, 400, "Enter your full name as the ticket signature.");
    if (!attested) return jsonError(response, 400, "Confirm the ticket attestation before signing.");
    if (!gps) return jsonError(response, 400, "A valid GPS position is required for ticket sign-off.");

    const db = getFirestore();
    const companyId = workspaceCompanyId(request.osSession);
    const taskSnapshot = await db.collection(COLLECTIONS.workspaceRecords).where("companyId", "==", companyId).get();
    const taskDocument = taskSnapshot.docs.find((doc) => {
      const stored = doc.data() || {};
      const task = stored.data || {};
      return stored.field === "tasks" && [stored.recordId, task.id, task.taskId].includes(taskId);
    });
    if (!taskDocument) return jsonError(response, 404, "The assigned ticket could not be found.");
    const storedTask = taskDocument.data() || {};
    const task = storedTask.data || {};
    const user = request.osSession.user || {};
    const assignedTaskIds = new Set(parseStringList(user.assignedTaskIds || []));
    const assignedJobIds = new Set(parseStringList(user.assignedJobIds || []));
    const assignedByTaskId = assignedTaskIds.has(taskId);
    const assignedByIdentity = task.assigneeId === request.osSession.uid
      || normalizeEmail(task.assigneeEmail) === normalizeEmail(request.osSession.email);
    const hasExplicitAssignee = Boolean(task.assigneeId || normalizeEmail(task.assigneeEmail));
    const assignedByJob = !hasExplicitAssignee && task.relatedJob && assignedJobIds.has(String(task.relatedJob));
    const assignedToEmployee = assignedByTaskId || assignedByIdentity || assignedByJob;
    if (!assignedToEmployee) {
      return jsonError(response, 403, "This ticket is not assigned to the signed-in employee.");
    }

    const priorSnapshot = await db.collection(COLLECTIONS.employeeTicketSignoffs)
      .where("employeeUid", "==", request.osSession.uid)
      .get();
    if (priorSnapshot.docs.some((doc) => (doc.data() || {}).taskId === taskId)) {
      return jsonError(response, 409, "This employee already signed off the selected ticket.");
    }

    const signedAt = new Date().toISOString();
    const signoffId = crypto.randomUUID();
    const signoff = {
      id: signoffId,
      taskId,
      taskTitle: String(task.title || "Work ticket").slice(0, 240),
      jobId: String(task.relatedJob || task.jobId || "").slice(0, 160),
      companyId,
      franchiseIds: parseFranchiseIds(request.osSession.franchiseIds || []),
      contractorId: String(request.osSession.contractorId || user.contractorId || "").trim(),
      employerUid: String(user.employerUid || "").trim(),
      employerEmail: normalizeEmail(user.employerEmail),
      employerContractorId: String(user.employerContractorId || request.osSession.contractorId || "").trim(),
      employeeUid: request.osSession.uid,
      employeeEmail: normalizeEmail(request.osSession.email),
      employeeName: String(user.displayName || request.osSession.email || "Employee").slice(0, 160),
      typedSignature,
      attested: true,
      gps,
      status: "signed",
      signedAt,
      createdAt: signedAt,
      updatedAt: signedAt
    };
    await db.collection(COLLECTIONS.employeeTicketSignoffs).doc(signoffId).set(signoff);
    await db.collection(COLLECTIONS.workspaceRecords).doc(taskDocument.id).set({
      data: {
        ...task,
        status: "Complete",
        signedOffAt: signedAt,
        signedOffByUid: request.osSession.uid,
        signedOffByEmail: request.osSession.email,
        ticketSignoffId: signoffId
      },
      updatedAt: signedAt,
      updatedByUid: request.osSession.uid,
      updatedByEmail: request.osSession.email
    }, { merge: true });
    await db.collection(COLLECTIONS.users).doc(request.osSession.uid).set({
      lastTicketSignoffAt: signedAt,
      updatedAt: signedAt
    }, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_ticket_signed",
      targetType: "task",
      targetId: taskId,
      metadata: {
        signoffId,
        employerUid: signoff.employerUid,
        employerContractorId: signoff.employerContractorId,
        jobId: signoff.jobId,
        gpsAccuracy: gps.accuracy
      }
    });
    return response.status(201).json({ success: true, signoff, task: { ...task, status: "Complete", ticketSignoffId: signoffId } });
  });

  router.get("/api/business-data", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) {
      const businessData = getDefaultBusinessRecords().filter((record) => canViewBusinessRecord(request.osSession, record));
      return response.json({ success: true, businessData });
    }
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.businessRecords).get();
    const businessData = snapshot.docs.map(docDataWithId).filter((record) => canViewBusinessRecord(request.osSession, record));
    return response.json({ success: true, businessData });
  });

  router.get("/api/workspace-state", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) {
      return response.json({
        success: true,
        durable: false,
        exists: false,
        recordCount: 0,
        updatedAt: "",
        workspaceState: {}
      });
    }
    const result = await readWorkspaceState(request.osSession);
    return response.json({ success: true, durable: true, ...result });
  });

  router.put("/api/workspace-state", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    try {
      const result = await writeWorkspaceState(request.osSession, request.body?.workspaceState || {});
      await writeAuditLog(getFirestore(), {
        actorUid: request.osSession.uid,
        actorRoleId: request.osSession.roleId,
        eventType: "workspace_state_saved",
        targetType: "workspace",
        targetId: workspaceCompanyId(request.osSession),
        metadata: {
          savedRecords: result.savedRecords,
          ignoredRecords: result.ignoredRecords
        }
      });
      return response.json({ success: true, durable: true, ...result });
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 400), error?.message || "Workspace state could not be saved.");
    }
  });

  router.post("/api/workspace-assets", requireAction("uploadImages"), async (request, response) => {
    try {
      const asset = await saveWorkspaceAsset(request.osSession, request.body || {});
      await writeAuditLog(getFirestore(), {
        actorUid: request.osSession.uid,
        actorRoleId: request.osSession.roleId,
        eventType: "workspace_asset_uploaded",
        targetType: "workspace_asset",
        targetId: asset.id,
        metadata: {
          fileName: asset.fileName,
          contentType: asset.contentType,
          size: asset.size,
          jobId: asset.jobId,
          taskId: asset.taskId
        }
      });
      return response.status(201).json({ success: true, asset });
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 400), error?.message || "Workspace file could not be uploaded.");
    }
  });

  router.get("/api/workspace-assets/:assetId", requireSession, async (request, response) => {
    const db = getFirestore();
    const bucket = typeof getFirebaseStorageBucket === "function" ? getFirebaseStorageBucket() : null;
    if (!db || !bucket) return adminDataStoreRequired(response);
    const snapshot = await db.collection(COLLECTIONS.workspaceAssets).doc(request.params.assetId).get();
    if (!snapshot.exists) return jsonError(response, 404, "Workspace file not found.");
    const asset = snapshot.data() || {};
    if (asset.companyId !== workspaceCompanyId(request.osSession)
      || !canAccessWorkspaceRecord(request.osSession, "photoRecords", asset)) {
      return jsonError(response, 403, "You do not have access to this workspace file.");
    }
    try {
      const [buffer] = await bucket.file(asset.objectPath).download();
      response.setHeader("Content-Type", asset.contentType || "application/octet-stream");
      response.setHeader("Content-Length", String(buffer.length));
      response.setHeader("Cache-Control", "private, max-age=300");
      response.setHeader("Content-Disposition", `inline; filename="${String(asset.fileName || "file").replace(/["\r\n]/g, "")}"`);
      return response.send(buffer);
    } catch (_error) {
      return jsonError(response, 404, "Workspace file is unavailable.");
    }
  });

  router.get("/api/community/posts", requireAction("postCommunityMessages"), async (_request, response) => {
    if (!firebaseAdminDataStoreConfigured()) {
      return response.json({ success: true, posts: buildFallbackAccessContext({ permissions: buildEffectivePermissions("super_admin", {}) }).communityPosts });
    }
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.communityPosts).orderBy("createdAt", "desc").limit(100).get();
    return response.json({ success: true, posts: snapshot.docs.map(docDataWithId) });
  });

  router.post("/api/community/posts", requireAction("postCommunityMessages"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const title = String(request.body?.title || "").trim();
    const body = String(request.body?.body || "").trim();
    if (!title || !body) return jsonError(response, 400, "Post title and body are required.");
    const now = new Date().toISOString();
    const post = {
      title,
      body,
      tags: Array.isArray(request.body?.tags) ? request.body.tags : String(request.body?.tags || "").split(",").map((item) => item.trim()).filter(Boolean),
      visibility: "contractors",
      authorUid: request.osSession.uid,
      authorEmail: request.osSession.email,
      authorRoleId: request.osSession.roleId,
      contractorId: request.osSession.contractorId || "",
      companyId: request.osSession.companyId || "",
      franchiseIds: request.osSession.franchiseIds || [],
      comments: [],
      createdAt: now,
      updatedAt: now
    };
    const ref = await db.collection(COLLECTIONS.communityPosts).add(post);
    return response.status(201).json({ success: true, post: { id: ref.id, ...post } });
  });

  router.post("/api/community/posts/:postId/comments", requireAction("postCommunityMessages"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const postRef = db.collection(COLLECTIONS.communityPosts).doc(request.params.postId);
    const snapshot = await postRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "Post not found.");
    const body = String(request.body?.body || "").trim();
    if (!body) return jsonError(response, 400, "Comment body is required.");
    const post = snapshot.data();
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const comment = {
      id: `comment-${crypto.randomBytes(6).toString("hex")}`,
      body,
      authorUid: request.osSession.uid,
      authorEmail: request.osSession.email,
      authorRoleId: request.osSession.roleId,
      createdAt: new Date().toISOString()
    };
    await postRef.set({
      comments: [...comments, comment],
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return response.status(201).json({ success: true, comment });
  });

  router.patch("/api/community/posts/:postId", requireAction("moderateCommunityMessages"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const updates = {};
    if (typeof request.body?.status === "string") updates.status = request.body.status;
    if (typeof request.body?.pinned === "boolean") updates.pinned = request.body.pinned;
    updates.updatedAt = new Date().toISOString();
    await db.collection(COLLECTIONS.communityPosts).doc(request.params.postId).set(updates, { merge: true });
    return response.json({ success: true });
  });

  router.post("/api/rbac/bootstrap", requireAction("manageRolePermissions"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    await seedDefaults(db);
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "rbac_bootstrap",
      targetType: "system",
      targetId: "bootstrap"
    });
    return response.json({ success: true });
  });

  router.get("/api/rbac/context", requireSession, async (request, response) => {
    const context = await buildAccessContext(request.osSession);
    return response.json({ success: true, ...context });
  });

  router.get("/api/rbac/users", requireAction("manageUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return response.json({ success: true, users: [publicUserRecord(request.osSession.user)] });
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const [firestoreUsers, authUsers] = await Promise.all([
      db.collection(COLLECTIONS.users).get(),
      typeof auth.listUsers === "function" ? auth.listUsers(1000) : Promise.resolve({ users: [] })
    ]);
    const authMap = new Map(authUsers.users.map((user) => [user.uid, user]));
    const users = firestoreUsers.docs
      .map((doc) => normalizeUserRecord(doc.id, authMap.get(doc.id), doc.data()))
      .filter((user) => canViewUserRecord(request.osSession, user));
    return response.json({ success: true, users: users.map(publicUserRecord) });
  });

  router.post("/api/rbac/users", requireAction("manageUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const email = String(request.body?.email || "").trim().toLowerCase();
    const displayName = String(request.body?.displayName || request.body?.name || email).trim();
    const roleId = String(request.body?.roleId || "worker").trim();
    const accessCode = String(request.body?.accessCode || "").trim() || createAccessCode(roleId);
    const ttlHours = clampAccessHours(request.body?.ttlHours || 48);
    const accessExpiresAt = hoursFromNow(ttlHours);
    const companyId = String(request.body?.companyId || (isSuperAdminSession(request.osSession) ? "default-company" : request.osSession.companyId || "default-company")).trim();
    const requestedFranchiseIds = parseFranchiseIds(request.body?.franchiseIds);
    const franchiseIds = !isSuperAdminSession(request.osSession) && !requestedFranchiseIds.length
      ? parseFranchiseIds(request.osSession.franchiseIds || [])
      : requestedFranchiseIds;

    if (!email || !email.includes("@")) return jsonError(response, 400, "A valid Google email is required.");
    const superAdminRequest = validateSuperAdminEmailAssignment(roleId, email);
    if (!superAdminRequest.ok) return jsonError(response, superAdminRequest.statusCode, superAdminRequest.message);
    const mutationPayload = {
      roleId,
      companyId,
      franchiseIds,
      contractorId: String(request.body?.contractorId || "").trim()
    };
    applyUserAccessControlFields(mutationPayload, request.body || {});
    if (accessCode) mutationPayload.accessCode = accessCode;
    mutationPayload.accessExpiresAt = accessExpiresAt;
    mutationPayload.accessScope = "48_hour_access";
    const mutationResult = validateSensitiveUserMutation(request.osSession, mutationPayload);
    if (!mutationResult.ok) return jsonError(response, mutationResult.statusCode, mutationResult.message);

    let createdUser = null;
    if (typeof auth.getUserByEmail === "function") {
      try {
        createdUser = await auth.getUserByEmail(email);
      } catch (error) {
        const code = String(error?.code || "");
        if (code && code !== "auth/user-not-found") throw error;
      }
    }
    if (!createdUser) {
      createdUser = await auth.createUser({
        email,
        displayName,
        disabled: false
      });
    } else if (typeof auth.updateUser === "function" && (createdUser.disabled || (displayName && displayName !== createdUser.displayName))) {
      createdUser = await auth.updateUser(createdUser.uid, {
        displayName,
        disabled: false
      });
    }
    const token = createToken();
    const now = new Date().toISOString();
    const grant = {
      email,
      displayName,
      roleId,
      companyId,
      franchiseIds,
      contractorId: String(request.body?.contractorId || "").trim(),
      accessScope: "48_hour_access",
      status: "issued",
      tokenHash: hashSecret(token),
      portalCodeHash: hashPortalCode(accessCode),
      accessCodeId: `code-${crypto.randomBytes(4).toString("hex")}`,
      failedCodeAttempts: 0,
      codeLockedUntil: "",
      expiresAt: accessExpiresAt,
      createdAt: now,
      updatedAt: now,
      createdByUid: request.osSession.uid,
      createdByEmail: request.osSession.email,
      permissionsOverride: mutationPayload.permissionsOverride || {},
      visibleTabIds: mutationPayload.visibleTabIds || [],
      visiblePageIds: mutationPayload.visiblePageIds || [],
      sectionOverrides: mutationPayload.sectionOverrides || {},
      assignedJobIds: mutationPayload.assignedJobIds || [],
      assignedTaskIds: mutationPayload.assignedTaskIds || []
    };
    const grantRef = await db.collection(COLLECTIONS.accessGrants).add(grant);
    const accessLink = buildAccessLink(request, token);
    const userRecord = normalizeUserRecord(createdUser.uid, createdUser, {
      roleId,
      companyId,
      franchiseIds,
      contractorId: String(request.body?.contractorId || "").trim(),
      accessGrantId: grantRef.id,
      accessCodeId: grant.accessCodeId,
      accessExpiresAt,
      accessScope: "48_hour_access",
      portalCodeHash: hashPortalCode(accessCode),
      status: "pending_access",
      permissionsOverride: mutationPayload.permissionsOverride || {},
      visibleTabIds: mutationPayload.visibleTabIds || [],
      visiblePageIds: mutationPayload.visiblePageIds || [],
      sectionOverrides: mutationPayload.sectionOverrides || {},
      assignedJobIds: mutationPayload.assignedJobIds || [],
      assignedTaskIds: mutationPayload.assignedTaskIds || []
    });
    await db.collection(COLLECTIONS.users).doc(createdUser.uid).set(userRecord, { merge: true });
    await auth.setCustomUserClaims(createdUser.uid, {
      roleId,
      companyId: userRecord.companyId,
      franchiseIds: userRecord.franchiseIds,
      contractorId: userRecord.contractorId || "",
      accessExpiresAt: userRecord.accessExpiresAt || ""
    });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "user_created",
      targetType: "user",
      targetId: createdUser.uid,
      metadata: { email, roleId }
    });
    const emailDelivery = request.body?.sendEmail === false
      ? { status: "skipped", message: "Invite email was not requested." }
      : await sendAccessInviteEmail({
          email,
          displayName,
          roleId,
          accessCode,
          accessLink,
          expiresAt: accessExpiresAt,
          createdByEmail: request.osSession.email
        });
    return response.status(201).json({
      success: true,
      user: publicUserRecord(userRecord),
      grant: { id: grantRef.id, ...grant, tokenHash: undefined, portalCodeHash: undefined },
      accessCode,
      accessLink,
      emailDelivery
    });
  });

  router.patch("/api/rbac/users/:uid", requireAction("manageUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const uid = request.params.uid;
    const updates = request.body && typeof request.body === "object" ? { ...request.body } : {};
    delete updates.tokenHash;
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "User not found.");
    const currentData = snapshot.data() || {};
    if (!canViewUserRecord(request.osSession, normalizeUserRecord(uid, null, currentData))) {
      return jsonError(response, 403, "You can manage users only inside your assigned scope.");
    }
    const nextRoleId = Object.prototype.hasOwnProperty.call(updates, "roleId") ? updates.roleId : currentData.roleId;
    const nextEmail = updates.email || currentData.email;
    const superAdminRequest = validateSuperAdminEmailAssignment(nextRoleId, nextEmail);
    if (!superAdminRequest.ok) return jsonError(response, superAdminRequest.statusCode, superAdminRequest.message);
    const mutationResult = validateSensitiveUserMutation(request.osSession, updates, currentData);
    if (!mutationResult.ok) return jsonError(response, mutationResult.statusCode, mutationResult.message);

    if (Object.prototype.hasOwnProperty.call(updates, "franchiseIds")) {
      updates.franchiseIds = parseFranchiseIds(updates.franchiseIds);
    }
    applyUserAccessControlFields(updates, updates);
    if (typeof updates.accessCode === "string" && updates.accessCode.trim()) {
      updates.portalCodeHash = hashPortalCode(updates.accessCode);
      updates.accessCodeId = `manual-${crypto.randomBytes(8).toString("hex")}`;
      updates.failedCodeAttempts = 0;
      updates.codeLockedUntil = "";
    }
    delete updates.accessCode;
    if (Object.prototype.hasOwnProperty.call(request.body || {}, "portalCodeHash") && !updates.accessCodeId) {
      delete updates.portalCodeHash;
    }

    const nextData = {
      ...currentData,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await userRef.set(nextData, { merge: true });

    const authUpdates = {};
    if (typeof updates.displayName === "string") authUpdates.displayName = updates.displayName;
    if (typeof updates.disabled === "boolean") authUpdates.disabled = updates.disabled;
    if (Object.keys(authUpdates).length) {
      await auth.updateUser(uid, authUpdates);
    }
    if (updates.roleId || updates.companyId || updates.franchiseIds || updates.contractorId || updates.accessExpiresAt) {
      await auth.setCustomUserClaims(uid, {
        roleId: updates.roleId || nextData.roleId,
        companyId: updates.companyId || nextData.companyId,
        franchiseIds: updates.franchiseIds || nextData.franchiseIds || [],
        contractorId: updates.contractorId || nextData.contractorId || "",
        accessExpiresAt: updates.accessExpiresAt || nextData.accessExpiresAt || ""
      });
    }

    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "user_updated",
      targetType: "user",
      targetId: uid,
      metadata: publicUserRecord(updates)
    });

    return response.json({ success: true, user: publicUserRecord(nextData) });
  });

  router.post("/api/rbac/users/:uid/reset-permissions", requireAction("resetPermissions"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const uid = request.params.uid;
    const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (!snapshot.exists) return jsonError(response, 404, "User not found.");
    if (!canViewUserRecord(request.osSession, normalizeUserRecord(uid, null, snapshot.data()))) {
      return jsonError(response, 403, "You can manage users only inside your assigned scope.");
    }
    await db.collection(COLLECTIONS.users).doc(uid).set({
      permissionsOverride: {},
      visibleTabIds: [],
      visiblePageIds: [],
      sectionOverrides: {},
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "user_permissions_reset",
      targetType: "user",
      targetId: uid
    });
    return response.json({ success: true });
  });

  router.delete("/api/rbac/users/:uid", requireAction("removeUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const uid = request.params.uid;
    const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get();
    if (!snapshot.exists) return jsonError(response, 404, "User not found.");
    if (!canViewUserRecord(request.osSession, normalizeUserRecord(uid, null, snapshot.data()))) {
      return jsonError(response, 403, "You can manage users only inside your assigned scope.");
    }
    await db.collection(COLLECTIONS.users).doc(uid).delete();
    await auth.deleteUser(uid);
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "user_deleted",
      targetType: "user",
      targetId: uid
    });
    return response.json({ success: true });
  });

  router.get("/api/rbac/roles", requireSession, async (_request, response) => {
    if (!firebaseAdminDataStoreConfigured()) {
      return response.json({
        success: true,
        roles: getSystemRoles(),
        permissions: Object.entries(getSystemPermissions()).map(([roleId, permissions]) => ({ roleId, ...permissions }))
      });
    }
    const db = getFirestore();
    const [rolesSnapshot, permissionsSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.roles).orderBy("rank", "desc").get(),
      db.collection(COLLECTIONS.permissions).get()
    ]);
    return response.json({
      success: true,
      roles: rolesSnapshot.docs.map((doc) => doc.data()),
      permissions: permissionsSnapshot.docs.map((doc) => doc.data())
    });
  });

  router.patch("/api/rbac/permissions/:roleId", requireAction("manageRolePermissions"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const roleId = request.params.roleId;
    const payload = request.body && typeof request.body === "object" ? request.body : {};
    await db.collection(COLLECTIONS.permissions).doc(roleId).set({
      roleId,
      ...payload,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "role_permissions_updated",
      targetType: "permission",
      targetId: roleId,
      metadata: payload
    });
    return response.json({ success: true });
  });

  router.post("/api/rbac/permissions/:roleId/reset", requireAction("resetPermissions"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const roleId = request.params.roleId;
    await db.collection(COLLECTIONS.permissions).doc(roleId).set({
      roleId,
      ...getSystemPermissions()[roleId],
      updatedAt: new Date().toISOString()
    }, { merge: false });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "role_permissions_reset",
      targetType: "permission",
      targetId: roleId
    });
    return response.json({ success: true });
  });

  async function patchCollectionDoc(collectionName, id, payload, request) {
    if (!firebaseAdminDataStoreConfigured()) {
      return { ok: false };
    }
    const db = getFirestore();
    await db.collection(collectionName).doc(id).set({
      ...payload,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: `${collectionName}_updated`,
      targetType: collectionName,
      targetId: id,
      metadata: payload
    });
  }

  router.patch("/api/rbac/tabs/:id", requireAction("manageTabs"), async (request, response) => {
    const result = await patchCollectionDoc(COLLECTIONS.tabs, request.params.id, request.body || {}, request);
    if (result?.ok === false) return adminDataStoreRequired(response);
    return response.json({ success: true });
  });

  router.patch("/api/rbac/pages/:id", requireAction("managePages"), async (request, response) => {
    const result = await patchCollectionDoc(COLLECTIONS.pages, request.params.id, request.body || {}, request);
    if (result?.ok === false) return adminDataStoreRequired(response);
    return response.json({ success: true });
  });

  router.patch("/api/rbac/page-sections/:id", requireAction("manageSections"), async (request, response) => {
    const result = await patchCollectionDoc(COLLECTIONS.pageSections, request.params.id, request.body || {}, request);
    if (result?.ok === false) return adminDataStoreRequired(response);
    return response.json({ success: true });
  });

  router.patch("/api/rbac/company-settings/default", requireAction("editCompanySettings"), async (request, response) => {
    const result = await patchCollectionDoc(COLLECTIONS.companySettings, "default", request.body || {}, request);
    if (result?.ok === false) return adminDataStoreRequired(response);
    return response.json({ success: true });
  });

  router.patch("/api/rbac/franchise-settings/:id", requireAction("editFranchiseSettings"), async (request, response) => {
    const result = await patchCollectionDoc(COLLECTIONS.franchiseSettings, request.params.id, request.body || {}, request);
    if (result?.ok === false) return adminDataStoreRequired(response);
    return response.json({ success: true });
  });

  router.get("/api/rbac/audit-logs", requireAction("viewAuditLogs"), async (_request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return response.json({ success: true, auditLogs: [] });
    const db = getFirestore();
    const snapshot = await db.collection(COLLECTIONS.auditLogs).orderBy("createdAt", "desc").limit(200).get();
    return response.json({
      success: true,
      auditLogs: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    });
  });

  router.post("/api/rbac/assets", requireAction("manageSections"), async (request, response) => {
    try {
      const asset = await saveWorkspaceAsset(request.osSession, request.body || {});
      return response.status(201).json({ success: true, assetUrl: asset.assetUrl, asset });
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 400), error?.message || "Section image could not be uploaded.");
    }
  });

  return {
    router,
    requireSession,
    requireAction,
    sessionCookieName
  };
}

module.exports = {
  createFirebaseRbacRouter
};
