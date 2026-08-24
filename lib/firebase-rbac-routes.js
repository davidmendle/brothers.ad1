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
const employeeEmploymentTypes = [
  "Employee",
  "Part-time employee",
  "Seasonal employee",
  "Independent contractor"
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
  workspaceRevisions: "osWorkspaceRevisions",
  workspaceAssets: "osWorkspaceAssets"
};

const WORKSPACE_ARRAY_FIELDS = [
  "files", "moduleRecords", "queue", "activity", "standardsOutputs", "learnedJargon",
  "equipmentDeployments", "dryLogs", "jobBoards", "contacts", "branches",
  "priceItems", "xactimateImports", "teamMembers", "tasks", "photoRecords", "contractorBills",
  "sketchRooms", "sketchWalls", "skillPacks", "dataVaults", "serviceRequests",
  "calloutSchedule", "timeEntries", "activeClockSessions", "aiCopilotMemory", "aiCopilotMessages"
];
const WORKSPACE_SETTING_FIELDS = [
  "estimateDraft", "quickBooksConnection", "accountProfile",
  "performanceMetrics", "actionDashboard", "institutionalReview",
  "serviceSettings", "aiCopilotProfile", "industryProfile"
];
const WORKSPACE_ARRAY_FIELD_SET = new Set(WORKSPACE_ARRAY_FIELDS);
const WORKSPACE_SETTING_FIELD_SET = new Set(WORKSPACE_SETTING_FIELDS);
const FIELD_USER_READABLE_WORKSPACE_FIELDS = new Set([
  "files", "moduleRecords", "equipmentDeployments", "dryLogs", "jobBoards", "tasks",
  "photoRecords", "contractorBills", "serviceRequests", "timeEntries", "activeClockSessions"
]);
const FIELD_USER_EDITABLE_WORKSPACE_FIELDS = new Set([
  "files", "equipmentDeployments", "dryLogs", "jobBoards", "tasks",
  "photoRecords", "contractorBills", "serviceRequests", "timeEntries", "activeClockSessions"
]);
const WORKSPACE_MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const WORKSPACE_MAX_RECORDS_PER_FIELD = 2500;
const WORKSPACE_TRANSACTION_MAX_WRITES = 450;
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

function normalizeEmployeeDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
}

function parseEmployeeEmploymentType(value, defaultValue = "") {
  const candidate = String(value || "").trim();
  if (!candidate && defaultValue) return { ok: true, value: defaultValue };
  const matched = employeeEmploymentTypes.find((type) => type.toLowerCase() === candidate.toLowerCase());
  return matched
    ? { ok: true, value: matched }
    : { ok: false, message: "Select a supported employee employment type." };
}

function parseEmployeeStartDate(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return { ok: true, value: "" };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) return { ok: false, message: "Employee start date must use YYYY-MM-DD format." };
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, message: "Employee start date must be a real calendar date." };
  }
  return { ok: true, value: candidate };
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

function detectWorkspaceAssetContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return "";
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

function workspaceLocationScopeKey(record = {}) {
  const franchiseId = String(record.franchiseId || "").trim();
  const branchId = String(record.branchId || "").trim();
  if (franchiseId || branchId) {
    return `franchise:${franchiseId || "unassigned"}|branch:${branchId || "unassigned"}`;
  }
  return "unscoped";
}

function workspaceRecordScopeKey(record = {}) {
  const contractorId = String(record.contractorId || record.employerContractorId || "").trim();
  return `${workspaceLocationScopeKey(record)}|contractor:${contractorId || "unassigned"}`;
}

function workspaceDocumentId(companyId, field, recordId, record = {}) {
  return hashSecret(`${companyId}\u0000${field}\u0000${workspaceRecordScopeKey(record)}\u0000${recordId}`).slice(0, 48);
}

function workspaceAssignmentScopeKey(record = {}, recordId = "") {
  return hashSecret(`${workspaceRecordScopeKey(record)}\u0000${String(recordId || "").trim().toLowerCase()}`).slice(0, 40);
}

function legacyWorkspaceAssignmentScopeKey(record = {}, recordId = "") {
  return hashSecret(`${workspaceLocationScopeKey(record)}\u0000${String(recordId || "").trim().toLowerCase()}`).slice(0, 40);
}

function workspaceSettingDocumentId(companyId, field) {
  return hashSecret(`${companyId}\u0000setting\u0000${field}`).slice(0, 48);
}

function workspaceRevisionDocumentId(companyId) {
  return hashSecret(`${companyId}\u0000workspace-revision`).slice(0, 48);
}

function employeeInvitationDocumentId(companyId, contractorId, email) {
  return hashSecret(`${companyId}\u0000employee-invitation\u0000${String(contractorId || "").trim()}\u0000${normalizeEmail(email)}`).slice(0, 48);
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

function normalizeOsUserRecord(uid, authUser, data = {}) {
  const record = normalizeUserRecord(uid, authUser, data);
  const storedDisplayName = String(data.displayName || "").trim();
  if (storedDisplayName) record.displayName = storedDisplayName;
  record.employmentType = String(data.employmentType || "").trim();
  record.startDate = String(data.startDate || "").trim();
  record.assignedJobScopeKeys = Array.isArray(data.assignedJobScopeKeys)
    ? data.assignedJobScopeKeys.map(String).filter(Boolean)
    : [];
  record.assignedTaskScopeKeys = Array.isArray(data.assignedTaskScopeKeys)
    ? data.assignedTaskScopeKeys.map(String).filter(Boolean)
    : [];
  return record;
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
  const employeeLink = grant.onboardingMode === "employee_link";
  return {
    displayName: grant.displayName || grant.email,
    roleId: grant.roleId || "contractor",
    companyId: grant.companyId || "default-company",
    franchiseIds: Array.isArray(grant.franchiseIds) ? grant.franchiseIds : [],
    contractorId: grant.contractorId || "",
    accessGrantId: grant.id || grant.grantId || "",
    accessCodeId: grant.accessCodeId || "",
    accessExpiresAt: employeeLink ? "" : (grant.expiresAt || ""),
    accessScope: grant.accessScope || "48_hour_access",
    portalCodeHash: grant.portalCodeHash || "",
    permissionsOverride: grant.permissionsOverride && typeof grant.permissionsOverride === "object" ? grant.permissionsOverride : {},
    visibleTabIds: Array.isArray(grant.visibleTabIds) ? grant.visibleTabIds : [],
    visiblePageIds: Array.isArray(grant.visiblePageIds) ? grant.visiblePageIds : [],
    sectionOverrides: grant.sectionOverrides && typeof grant.sectionOverrides === "object" ? grant.sectionOverrides : {},
    assignedJobIds: Array.isArray(grant.assignedJobIds) ? grant.assignedJobIds : [],
    assignedTaskIds: Array.isArray(grant.assignedTaskIds) ? grant.assignedTaskIds : [],
    assignedJobScopeKeys: Array.isArray(grant.assignedJobScopeKeys) ? grant.assignedJobScopeKeys : [],
    assignedTaskScopeKeys: Array.isArray(grant.assignedTaskScopeKeys) ? grant.assignedTaskScopeKeys : [],
    employerUid: grant.employerUid || "",
    employerEmail: grant.employerEmail || "",
    employerContractorId: grant.employerContractorId || grant.contractorId || "",
    onboardingMode: grant.onboardingMode || "",
    employmentStatus: grant.employmentStatus || "",
    phone: grant.phone || "",
    jobTitle: grant.jobTitle || "",
    employmentType: employeeLink ? (grant.employmentType || "Employee") : (grant.employmentType || ""),
    startDate: grant.startDate || "",
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

  async function assertStoredSessionAccess(userRecord, { allowEmployeeActivation = false } = {}) {
    const roleId = String(userRecord.roleId || "").trim();
    if (roleId === "super_admin" && !isOwnerIdentity(userRecord.uid || userRecord.id, userRecord.email)) {
      return { ok: false, statusCode: 403, message: "Super Admin access is restricted to the verified Brothers OS owner." };
    }
    if (userRecord.disabled || String(userRecord.status || "").toLowerCase() === "pending_access") {
      return { ok: false, statusCode: 403, message: "This email is not approved yet. Request trial access or ask the Super Admin for a contractor code." };
    }
    const managedEmployeeAccount = roleId === "worker" && Boolean(
      String(userRecord.onboardingMode || "").trim() === "employee_link"
      || String(userRecord.employmentStatus || "").trim()
      || String(userRecord.employerUid || "").trim()
      || String(userRecord.employerContractorId || "").trim()
    );
    if (managedEmployeeAccount && !allowEmployeeActivation
      && (String(userRecord.status || "").toLowerCase() !== "active"
        || String(userRecord.employmentStatus || "").toLowerCase() !== "active")) {
      return { ok: false, statusCode: 403, message: "This employee account is inactive. Ask the employer to restore access." };
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
    const storedAccess = await assertStoredSessionAccess(userRecord, {
      allowEmployeeActivation: options.grant?.onboardingMode === "employee_link"
    });
    if (!storedAccess.ok) return storedAccess;
    const roleId = String(userRecord.roleId || "").trim();
    if (roleId !== "super_admin") {
      if (options.grant?.onboardingMode === "employee_link" && roleId === "worker") {
        return { ok: true };
      }
      const returningEmployee = roleId === "worker"
        && userRecord.onboardingMode === "employee_link"
        && userRecord.accessScope === "employee_portal"
        && userRecord.employmentStatus === "active"
        && Boolean(userRecord.contractorId && userRecord.employerContractorId);
      if (returningEmployee) {
        if (String(options.accessToken || "").trim()) {
          return { ok: false, statusCode: 403, message: "This employee invitation link was already used or is no longer valid." };
        }
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
      const revokedRecord = normalizeOsUserRecord(decodedToken.uid, authUser, {
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
      const existing = normalizeOsUserRecord(decodedToken.uid, authUser, snapshot.data());
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
    const record = normalizeOsUserRecord(decodedToken.uid, authUser, candidateRecord);
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
    if (!grant?.id) return userRecord;
    const db = getFirestore();
    const auth = getFirebaseAuth();
    const grantRef = db.collection(COLLECTIONS.accessGrants).doc(grant.id);
    const canonicalEmployeeGrantRef = grant.onboardingMode === "employee_link"
      ? db.collection(COLLECTIONS.accessGrants).doc(employeeInvitationDocumentId(
          grant.companyId || userRecord.companyId,
          grant.employerContractorId || grant.contractorId,
          grant.email
        ))
      : null;
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
    const authUser = {
      uid: decodedToken.uid,
      email: normalizeEmail(decodedToken.email),
      displayName: decodedToken.name || decodedToken.email || "",
      disabled: false
    };
    let activatedUserRecord = userRecord;
    const buildActivatedUserRecord = (currentGrant, currentUser = {}) => normalizeOsUserRecord(
      decodedToken.uid,
      authUser,
      {
        ...currentUser,
        ...buildGrantUserFields({ id: grantRef.id, ...currentGrant }),
        status: "active",
        disabled: false,
        employmentStatus: currentGrant.onboardingMode === "employee_link"
          ? "active"
          : (currentUser.employmentStatus || ""),
        onboardingAcceptedAt: currentGrant.onboardingMode === "employee_link"
          ? now
          : (currentUser.onboardingAcceptedAt || ""),
        updatedAt: now
      }
    );
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
        const [currentSnapshot, canonicalSnapshot, currentUserSnapshot] = await Promise.all([
          transaction.get(grantRef),
          canonicalEmployeeGrantRef && canonicalEmployeeGrantRef.id !== grantRef.id
            ? transaction.get(canonicalEmployeeGrantRef)
            : Promise.resolve(null),
          transaction.get(userRef)
        ]);
        if (!currentSnapshot.exists) {
          const error = new Error("This access link is no longer available.");
          error.statusCode = 403;
          throw error;
        }
        const currentGrant = currentSnapshot.data() || {};
        assertGrantStillUsable(currentGrant);
        if (canonicalSnapshot?.exists) {
          const canonical = canonicalSnapshot.data() || {};
          if (["issued", "active"].includes(String(canonical.status || "").toLowerCase())
            && String(canonical.createdAt || "") >= String(currentGrant.createdAt || "")) {
            const error = new Error("A newer employee invitation replaced this access link.");
            error.statusCode = 403;
            throw error;
          }
        }
        activatedUserRecord = buildActivatedUserRecord(
          currentGrant,
          currentUserSnapshot.exists ? (currentUserSnapshot.data() || {}) : {}
        );
        transaction.set(grantRef, grantUpdates, { merge: true });
        transaction.set(userRef, activatedUserRecord, { merge: true });
      });
    } else {
      const currentSnapshot = await grantRef.get();
      if (!currentSnapshot.exists) {
        const error = new Error("This access link is no longer available.");
        error.statusCode = 403;
        throw error;
      }
      const currentGrant = currentSnapshot.data() || {};
      assertGrantStillUsable(currentGrant);
      const currentUserSnapshot = await userRef.get();
      activatedUserRecord = buildActivatedUserRecord(
        currentGrant,
        currentUserSnapshot.exists ? (currentUserSnapshot.data() || {}) : {}
      );
      await grantRef.set(grantUpdates, { merge: true });
      await userRef.set(activatedUserRecord, { merge: true });
    }
    if (grant.onboardingMode === "employee_link"
      && activatedUserRecord.displayName
      && typeof auth.updateUser === "function") {
      try {
        await auth.updateUser(decodedToken.uid, { displayName: activatedUserRecord.displayName });
      } catch (error) {
        console.error("Employee display name could not be synchronized to Firebase Authentication.", error);
      }
    }
    await auth.setCustomUserClaims(decodedToken.uid, {
      roleId: activatedUserRecord.roleId,
      companyId: activatedUserRecord.companyId,
      franchiseIds: activatedUserRecord.franchiseIds || [],
      contractorId: activatedUserRecord.contractorId || "",
      accessExpiresAt: activatedUserRecord.accessExpiresAt || ""
    });
    return activatedUserRecord;
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

  function resolveEmployeeModuleSelection(source = {}) {
    const inputKeys = ["visiblePageIds", "visibleTabIds", "visibleModuleKeys"];
    const suppliedKey = inputKeys.find((key) => Object.prototype.hasOwnProperty.call(source, key));
    if (!suppliedKey) return { ok: true, supplied: false, moduleIds: [] };

    const allowedModules = new Set(getSystemPermissions().worker.pages?.allowed || []);
    const requested = parseStringList(source[suppliedKey]);
    if (!requested.length) {
      return { ok: false, statusCode: 400, message: "Select at least one module available to employee accounts." };
    }
    const moduleIds = Array.from(new Set(requested.filter((moduleKey) => allowedModules.has(moduleKey))));
    if (requested.length && !moduleIds.length) {
      return { ok: false, statusCode: 400, message: "Select at least one module available to employee accounts." };
    }
    return {
      ok: true,
      supplied: true,
      moduleIds
    };
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
    const sameContractor = Boolean(sameCompany && session?.contractorId && userRecord.contractorId && session.contractorId === userRecord.contractorId);

    if (!sameCompany) return false;
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
    if (isSuperAdminSession(session)) return true;
    if (!sessionHasAction(session, "inviteWorkers") || grant.onboardingMode !== "employee_link") return false;
    if (workspaceCompanyId(session) !== String(grant.companyId || "default-company").trim()) return false;
    const roleId = String(session?.roleId || "").trim();
    if (roleId === "business_owner") return true;
    if (roleId === "franchise_owner") {
      const allowedFranchises = new Set(parseFranchiseIds(session.franchiseIds || []));
      return parseFranchiseIds(grant.franchiseIds || []).some((id) => allowedFranchises.has(id));
    }
    if (roleId !== "contractor") return false;
    const sessionContractorId = String(session?.contractorId || "").trim();
    const grantContractorId = String(grant.employerContractorId || grant.contractorId || "").trim();
    const currentEmployerUid = String(grant.employerUid || grant.createdByUid || "").trim();
    return Boolean(sessionContractorId
      && grantContractorId === sessionContractorId
      && currentEmployerUid === String(session.uid || "").trim());
  }

  function validateIssuedEmployeeGrantMutation(session, grant = {}) {
    if (grant.onboardingMode !== "employee_link") {
      return { ok: false, statusCode: 404, message: "Employee invitation not found." };
    }
    if (!canViewEmployeeGrant(session, grant)) {
      return { ok: false, statusCode: 403, message: "You can update only invitations issued for your contractor profile." };
    }
    if (String(grant.status || "issued").toLowerCase() !== "issued") {
      return { ok: false, statusCode: 409, message: "Only a pending employee invitation can be updated." };
    }
    if (!isFutureIso(grant.expiresAt)) {
      return { ok: false, statusCode: 410, message: "This employee invitation expired. Issue a new invitation before assigning work." };
    }
    return { ok: true };
  }

  function canViewTicketSignoff(session, signoff = {}) {
    const roleId = String(session?.roleId || "").trim();
    if (roleId === "super_admin") return true;
    if (!session?.companyId || signoff.companyId !== session.companyId) return false;
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
      record.workerEmail, record.ownerEmail, record.email, record.createdByUid,
      record.createdByEmail, record.employerUid, record.employerEmail,
      record.employerContractorId
    ]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
  }

  function sessionCanAccessWorkspaceModule(session, moduleKey) {
    const key = String(moduleKey || "").trim();
    if (!key) return false;
    const explicitModules = new Set([
      ...parseStringList(session?.visiblePageIds || session?.user?.visiblePageIds || []),
      ...parseStringList(session?.visibleTabIds || session?.user?.visibleTabIds || [])
    ]);
    if (explicitModules.size && !explicitModules.has(key)) return false;
    const pageAccess = session?.permissions?.pages || {};
    const allowed = new Set(parseStringList(pageAccess.allowed || []));
    const hidden = new Set(parseStringList(pageAccess.hidden || []));
    if (hidden.has(key)) return false;
    return pageAccess.mode === "all" || allowed.has(key);
  }

  function workspaceRecordModuleKeys(field, record = {}) {
    const fieldModules = {
      activeClockSessions: ["time"],
      contractorBills: ["payments"],
      dryLogs: ["drylogs"],
      equipmentDeployments: ["equipment"],
      jobBoards: ["jobs"],
      photoRecords: ["photos"],
      serviceRequests: ["forms"],
      timeEntries: ["time"]
    };
    if (field === "tasks" || field === "moduleRecords") {
      return parseStringList([record.moduleKey]);
    }
    if (field === "files") {
      const sourceModule = {
        employeeticketsignoff: "time",
        equipmentdeployment: "equipment",
        jobnote: "jobs",
        photoevidence: "photos",
        taskassignment: String(record.taskModuleKey || "jobs").trim(),
        timeentry: "time"
      }[String(record.sourceType || "").trim().toLowerCase()];
      return parseStringList([
        record.moduleKey,
        sourceModule,
        ...(Array.isArray(record.linkedModuleKeys) ? record.linkedModuleKeys : [])
      ]);
    }
    return fieldModules[field] || [];
  }

  function fieldUserCanAccessWorkspaceRecord(session, field, record = {}, { write = false } = {}) {
    if (!FIELD_USER_READABLE_WORKSPACE_FIELDS.has(field)) return false;
    const user = session?.user || {};
    const roleId = String(session?.roleId || "").trim();
    const assignedJobIds = new Set(parseStringList(user.assignedJobIds || []).map((value) => value.toLowerCase()));
    const assignedTaskIds = new Set(parseStringList(user.assignedTaskIds || []).map((value) => value.toLowerCase()));
    const assignedJobScopeKeys = new Set(parseStringList(user.assignedJobScopeKeys || []));
    const assignedTaskScopeKeys = new Set(parseStringList(user.assignedTaskScopeKeys || []));
    const userIdentities = [session?.uid, session?.email, user.id, user.uid, user.email];
    const contractorIdentities = [session?.contractorId, user.contractorId];
    const identities = new Set([
      ...userIdentities,
      ...(roleId === "worker" ? [] : contractorIdentities)
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    const references = workspaceRecordReferences(record);
    const jobReferences = [record.id, record.jobId, record.job, record.relatedJob]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const taskReferences = [record.id, record.taskId, record.relatedTask]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const assignmentScopeAllows = (scopeKeys, value) => !scopeKeys.size
      || scopeKeys.has(workspaceAssignmentScopeKey(record, value))
      || scopeKeys.has(legacyWorkspaceAssignmentScopeKey(record, value));
    const assignedJobReference = jobReferences.some((value) => assignedJobIds.has(value)
      && assignmentScopeAllows(assignedJobScopeKeys, value));
    const assignedTaskReference = taskReferences.some((value) => assignedTaskIds.has(value)
      && assignmentScopeAllows(assignedTaskScopeKeys, value));
    const assignedReference = assignedJobReference || assignedTaskReference;
    const identityReference = references.some((value) => identities.has(value));

    if (roleId === "worker") {
      const sessionContractorId = String(session?.contractorId || user.contractorId || user.employerContractorId || "").trim();
      const recordContractorId = String(record.contractorId || record.employerContractorId || "").trim();
      if (!sessionContractorId || recordContractorId !== sessionContractorId) return false;
    }

    if (roleId === "worker") {
      const moduleKeys = workspaceRecordModuleKeys(field, record);
      if (!moduleKeys.length || !moduleKeys.some((moduleKey) => sessionCanAccessWorkspaceModule(session, moduleKey))) {
        return false;
      }
    } else if (field === "moduleRecords" && !sessionCanAccessWorkspaceModule(session, record.moduleKey)) {
      return false;
    }

    if (field === "contractorBills") {
      return roleId === "contractor" && identityReference;
    }
    if (field === "files") {
      const sourceType = String(record.sourceType || "").trim().toLowerCase();
      const fileType = String(record.type || "").trim().toLowerCase();
      if (roleId === "worker" && ["timeentry", "employeeticketsignoff"].includes(sourceType)) {
        return identityReference && (!(jobReferences.length || taskReferences.length) || assignedReference);
      }
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
      const explicitAssigneeId = String(record.assigneeId || "").trim().toLowerCase();
      const explicitAssigneeEmail = normalizeEmail(record.assigneeEmail);
      const hasExplicitAssignee = Boolean(explicitAssigneeId || explicitAssigneeEmail);
      const explicitAssigneeMatches = (!explicitAssigneeId || identities.has(explicitAssigneeId))
        && (!explicitAssigneeEmail || identities.has(explicitAssigneeEmail));
      if (roleId === "worker" && hasExplicitAssignee) return explicitAssigneeMatches;
      const assignedTask = (taskId && assignedTaskIds.has(taskId)
        && assignmentScopeAllows(assignedTaskScopeKeys, taskId))
        || assignedTaskReference
        || assignedJobReference;
      if (write && roleId === "worker") return assignedTask;
      return assignedTask || identityReference;
    }
    if (["timeEntries", "activeClockSessions"].includes(field) && roleId === "worker") {
      return identityReference && (!(jobReferences.length || taskReferences.length) || assignedReference);
    }
    if (write && roleId === "worker") {
      return assignedReference;
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
    if (!FIELD_USER_READABLE_WORKSPACE_FIELDS.has(field)) return false;
    if (write && !FIELD_USER_EDITABLE_WORKSPACE_FIELDS.has(field)) return false;
    if (write && !sessionHasAction(session, "editAssignedTasks") && field !== "timeEntries" && field !== "photoRecords") {
      return false;
    }
    return fieldUserCanAccessWorkspaceRecord(session, field, record, { write });
  }

  function scopeWorkspaceRecordForWrite(session, field, record = {}, authorizedBranchIds = new Set()) {
    const roleId = String(session?.roleId || "").trim();
    if (!["super_admin", "business_owner"].includes(roleId)) {
      const assignedFranchises = parseStringList(session?.franchiseIds || []);
      const requestedFranchiseId = String(record.franchiseId || "").trim();
      if (requestedFranchiseId && !assignedFranchises.includes(requestedFranchiseId)) {
        const error = new Error("This record cannot be assigned outside the current franchise workspace.");
        error.statusCode = 403;
        throw error;
      }
      if (!requestedFranchiseId) {
        if (assignedFranchises.length !== 1) {
          const error = new Error("Choose one authorized franchise before saving this record.");
          error.statusCode = 403;
          throw error;
        }
        record = { ...record, franchiseId: assignedFranchises[0] };
      }
      const requestedBranchId = String(record.branchId || "").trim();
      const creatingBranchRecord = field === "branches" && roleId === "franchise_owner";
      if (requestedBranchId && !creatingBranchRecord && !authorizedBranchIds.has(requestedBranchId)) {
        const error = new Error("This record cannot be assigned to a branch outside the current franchise workspace.");
        error.statusCode = 403;
        throw error;
      }
    }
    if (roleId === "worker") {
      return {
        ...record,
        contractorId: String(session.contractorId || session.user?.contractorId || "").trim(),
        workerId: String(session.uid || "").trim(),
        workerEmail: normalizeEmail(session.email)
      };
    }
    if (roleId === "contractor") {
      return {
        ...record,
        contractorId: String(session.contractorId || "").trim(),
        contractorEmail: normalizeEmail(session.email)
      };
    }
    return record;
  }

  function preserveStoredWorkspaceScope(session, field, stored = {}, incoming = {}) {
    const protectedFields = ["franchiseId", "branchId", "contractorId"];
    const workerWrite = String(session?.roleId || "").trim() === "worker";
    if (workerWrite) {
      protectedFields.push(
        "id", "uid", "jobId", "relatedJob", "taskId", "relatedTask",
        "assigneeId", "assigneeEmail", "workerId", "workerEmail"
      );
      if (field === "tasks") {
        protectedFields.push(
          "status", "completedAt", "completedByEmail", "ticketSignoffId",
          "signedOffAt", "signedOffByUid", "signedOffByEmail"
        );
      }
    }
    let next = protectedFields.reduce((candidate, protectedField) => {
      if (Object.prototype.hasOwnProperty.call(stored, protectedField)) candidate[protectedField] = stored[protectedField];
      else delete candidate[protectedField];
      return candidate;
    }, { ...incoming });
    if (workerWrite && field === "tasks") {
      return {
        ...stored,
        ...(Array.isArray(incoming.photoEvidenceIds)
          ? { photoEvidenceIds: parseStringList(incoming.photoEvidenceIds) }
          : {}),
        ...(String(incoming.photoEvidenceAt || "").trim()
          ? { photoEvidenceAt: String(incoming.photoEvidenceAt).trim().slice(0, 64) }
          : {})
      };
    }
    if (workerWrite && field === "files"
      && ["employeeticketsignoff", "taskassignment", "timeentry"]
        .includes(String(stored.sourceType || "").trim().toLowerCase())) {
      return { ...stored };
    }
    if (workerWrite && ["timeEntries", "activeClockSessions"].includes(field)) return { ...stored };
    if (workerWrite && field === "jobBoards") {
      next = { ...stored };
      const ownerManagedGateIds = new Set(["authorization", "deposit", "invoice"]);
      const storedGates = new Map((Array.isArray(stored.gates) ? stored.gates : []).map((gate) => [String(gate?.id || "").trim().toLowerCase(), gate]));
      const incomingGates = new Map((Array.isArray(incoming.gates) ? incoming.gates : []).map((gate) => [String(gate?.id || "").trim().toLowerCase(), gate]));
      next.gates = Array.from(new Set([...storedGates.keys(), ...incomingGates.keys()])).filter(Boolean).map((gateId) => {
        const storedGate = storedGates.get(gateId);
        const incomingGate = incomingGates.get(gateId);
        if (ownerManagedGateIds.has(gateId)) {
          return storedGate || null;
        }
        return incomingGate || storedGate;
      }).filter(Boolean);
    }
    return next;
  }

  async function validateEmployeeAssignmentScope(session, {
    assignedJobIds = [],
    assignedTaskIds = [],
    employeeModuleIds = []
  } = {}) {
    const requestedJobs = new Set(parseStringList(assignedJobIds).map((value) => value.toLowerCase()));
    const requestedTasks = new Set(parseStringList(assignedTaskIds).map((value) => value.toLowerCase()));
    if (!requestedJobs.size && !requestedTasks.size) {
      return { ok: true, assignedJobScopeKeys: [], assignedTaskScopeKeys: [] };
    }

    const companyId = workspaceCompanyId(session);
    const snapshot = await getFirestore().collection(COLLECTIONS.workspaceRecords)
      .where("companyId", "==", companyId)
      .get();
    const authorizedJobs = new Map();
    const authorizedTasks = new Map();
    snapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      if (stored.deletedAt || !["jobBoards", "tasks"].includes(stored.field)) return;
      const data = cleanWorkspaceValue(stored.data || {});
      if (!canAccessWorkspaceRecord(session, stored.field, data)) return;
      const identifiers = [stored.recordId, data.id, data.jobId, data.taskId]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      const requested = stored.field === "jobBoards" ? requestedJobs : requestedTasks;
      const matches = stored.field === "jobBoards" ? authorizedJobs : authorizedTasks;
      identifiers.filter((id) => requested.has(id)).forEach((id) => {
        if (!matches.has(id)) matches.set(id, new Map());
        matches.get(id).set(doc.id, data);
      });
    });
    const unavailableJobs = [...requestedJobs].filter((id) => !authorizedJobs.get(id)?.size);
    const unavailableTasks = [...requestedTasks].filter((id) => !authorizedTasks.get(id)?.size);
    if (unavailableJobs.length || unavailableTasks.length) {
      return {
        ok: false,
        statusCode: 403,
        message: "One or more assigned jobs or tasks are unavailable to this employer. Select records from the current contractor workspace."
      };
    }
    const ambiguous = [
      ...[...authorizedJobs].filter(([, matches]) => matches.size !== 1).map(([id]) => `job ${id}`),
      ...[...authorizedTasks].filter(([, matches]) => matches.size !== 1).map(([id]) => `task ${id}`)
    ];
    if (ambiguous.length) {
      return {
        ok: false,
        statusCode: 409,
        message: `Assignment IDs must identify one scoped record. Resolve duplicates for: ${ambiguous.join(", ")}`
      };
    }
    const moduleIds = new Set(parseStringList(employeeModuleIds));
    const blockedTaskModules = [...authorizedTasks].flatMap(([id, matches]) => {
      const task = [...matches.values()][0] || {};
      const moduleKey = String(task.moduleKey || "").trim();
      return !moduleKey || (moduleIds.size && !moduleIds.has(moduleKey))
        ? [`${id} (${moduleKey || "missing module"})`]
        : [];
    });
    if (blockedTaskModules.length) {
      return {
        ok: false,
        statusCode: 403,
        message: `Enable each assigned ticket's module before assigning it: ${blockedTaskModules.join(", ")}`
      };
    }
    return {
      ok: true,
      assignedJobScopeKeys: [...authorizedJobs].map(([id, matches]) => workspaceAssignmentScopeKey([...matches.values()][0], id)),
      assignedTaskScopeKeys: [...authorizedTasks].map(([id, matches]) => workspaceAssignmentScopeKey([...matches.values()][0], id))
    };
  }

  function canAccessWorkspaceSetting(session) {
    return ["super_admin", "business_owner"].includes(String(session?.roleId || "").trim());
  }

  function workspaceConflictError() {
    const error = new Error("This workspace changed in another session. Reload the latest records before saving again.");
    error.statusCode = 409;
    return error;
  }

  async function commitWorkspaceOperations(db, session, operations, {
    baseRevision = "",
    baseRevisionProvided = false,
    baseUpdatedAt = "",
    baseUpdatedAtProvided = false,
    currentUpdatedAt = "",
    hasExistingDocuments = false,
    updatedAt = new Date().toISOString()
  } = {}) {
    if (typeof db.runTransaction !== "function") {
      const error = new Error("Atomic workspace persistence is unavailable.");
      error.statusCode = 503;
      throw error;
    }
    if (operations.length > WORKSPACE_TRANSACTION_MAX_WRITES) {
      const error = new Error(`This save contains ${operations.length} record changes. Archive completed records or save a smaller workspace before exceeding the ${WORKSPACE_TRANSACTION_MAX_WRITES}-record atomic limit.`);
      error.statusCode = 413;
      throw error;
    }
    const companyId = workspaceCompanyId(session);
    const revisionRef = db.collection(COLLECTIONS.workspaceRevisions).doc(workspaceRevisionDocumentId(companyId));
    const nextRevision = crypto.randomUUID();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(revisionRef);
      const storedRevision = snapshot.exists ? String(snapshot.data()?.revision || "").trim() : "";
      if (storedRevision) {
        if (!baseRevisionProvided || String(baseRevision || "").trim() !== storedRevision) {
          throw workspaceConflictError();
        }
      } else if (hasExistingDocuments
        && (!baseUpdatedAtProvided || String(baseUpdatedAt || "").trim() !== currentUpdatedAt)) {
        throw workspaceConflictError();
      }
      operations.forEach((operation) => {
        transaction.set(operation.ref, operation.data, { merge: operation.merge !== false });
      });
      transaction.set(revisionRef, {
        companyId,
        revision: nextRevision,
        updatedAt,
        updatedByUid: session.uid,
        updatedByEmail: session.email
      });
    });
    return nextRevision;
  }

  async function readWorkspaceState(session) {
    const db = getFirestore();
    const companyId = workspaceCompanyId(session);
    const [recordSnapshot, settingSnapshot, revisionSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.workspaceRecords).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.workspaceSettings).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.workspaceRevisions).doc(workspaceRevisionDocumentId(companyId)).get()
    ]);
    const workspaceState = {};
    const recordsByField = new Map();
    let latestUpdatedAt = "";

    recordSnapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      if (stored.deletedAt || !WORKSPACE_ARRAY_FIELD_SET.has(stored.field)) return;
      if (String(stored.updatedAt || "") > latestUpdatedAt) latestUpdatedAt = String(stored.updatedAt || "");
      const data = cleanWorkspaceValue(stored.data || {});
      if (!canAccessWorkspaceRecord(session, stored.field, data)) return;
      if (!recordsByField.has(stored.field)) recordsByField.set(stored.field, []);
      recordsByField.get(stored.field).push({
        sortIndex: Number(stored.sortIndex || 0),
        data
      });
    });
    recordsByField.forEach((records, field) => {
      workspaceState[field] = records
        .sort((left, right) => left.sortIndex - right.sortIndex)
        .map((record) => record.data);
    });

    settingSnapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      if (stored.deletedAt || !WORKSPACE_SETTING_FIELD_SET.has(stored.field)) return;
      if (String(stored.updatedAt || "") > latestUpdatedAt) latestUpdatedAt = String(stored.updatedAt || "");
      if (canAccessWorkspaceSetting(session)) {
        workspaceState[stored.field] = cleanWorkspaceValue(stored.value, stored.field);
      }
    });
    const revisionData = revisionSnapshot.exists ? (revisionSnapshot.data() || {}) : {};
    if (String(revisionData.updatedAt || "") > latestUpdatedAt) latestUpdatedAt = String(revisionData.updatedAt || "");

    return {
      workspaceState,
      exists: recordSnapshot.docs.some((doc) => !doc.data()?.deletedAt)
        || settingSnapshot.docs.some((doc) => !doc.data()?.deletedAt),
      recordCount: Array.from(recordsByField.values()).reduce((sum, records) => sum + records.length, 0),
      updatedAt: latestUpdatedAt,
      revision: String(revisionData.revision || "")
    };
  }

  async function writeWorkspaceState(session, input = {}, {
    baseRevision = "",
    baseRevisionProvided = false,
    baseUpdatedAt = "",
    baseUpdatedAtProvided = false
  } = {}) {
    const db = getFirestore();
    const companyId = workspaceCompanyId(session);
    if (Buffer.byteLength(JSON.stringify(input || {})) > WORKSPACE_MAX_REQUEST_BYTES) {
      const error = new Error("Workspace update is too large. Upload files separately and keep the workspace payload under 3 MB.");
      error.statusCode = 413;
      throw error;
    }
    let now = new Date().toISOString();
    const operations = [];
    const incomingDocumentIds = new Set();
    const fieldsWithIgnoredRecords = new Set();
    const consumedActiveClockDocumentIds = new Set();
    let savedRecords = 0;
    let ignoredRecords = 0;
    const roleId = String(session?.roleId || "").trim();
    const canDeleteWorkspaceRecords = ["super_admin", "business_owner", "franchise_owner"].includes(roleId);
    let incomingWorkerActiveClockCount = 0;
    const [
      existingSnapshot,
      existingSettingSnapshot,
      existingRevisionSnapshot,
      employeeUserSnapshot,
      employeeGrantSnapshot
    ] = await Promise.all([
      db.collection(COLLECTIONS.workspaceRecords).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.workspaceSettings).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.workspaceRevisions).doc(workspaceRevisionDocumentId(companyId)).get(),
      db.collection(COLLECTIONS.users).where("companyId", "==", companyId).get(),
      db.collection(COLLECTIONS.accessGrants).where("companyId", "==", companyId).get()
    ]);
    const activeExistingDocuments = [
      ...existingSnapshot.docs,
      ...existingSettingSnapshot.docs
    ].filter((doc) => !doc.data()?.deletedAt);
    let currentUpdatedAt = activeExistingDocuments.reduce((latest, doc) => {
      const updatedAt = String(doc.data()?.updatedAt || "");
      return updatedAt > latest ? updatedAt : latest;
    }, "");
    const currentRevisionData = existingRevisionSnapshot.exists ? (existingRevisionSnapshot.data() || {}) : {};
    const currentRevision = String(currentRevisionData.revision || "").trim();
    if (String(currentRevisionData.updatedAt || "") > currentUpdatedAt) {
      currentUpdatedAt = String(currentRevisionData.updatedAt || "");
    }
    if (currentRevision) {
      if (!baseRevisionProvided || String(baseRevision || "").trim() !== currentRevision) {
        throw workspaceConflictError();
      }
    } else if (activeExistingDocuments.length
      && (!baseUpdatedAtProvided || String(baseUpdatedAt || "").trim() !== currentUpdatedAt)) {
      throw workspaceConflictError();
    }
    if (currentUpdatedAt && now <= currentUpdatedAt) {
      now = new Date(Date.parse(currentUpdatedAt) + 1).toISOString();
    }
    const existingByFieldAndRecord = new Map();
    const existingByDocumentId = new Map();
    const authorizedBranchIds = new Set();
    existingSnapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      existingByDocumentId.set(doc.id, { doc, stored });
      const storedData = stored.data || {};
      if (!stored.deletedAt && canAccessWorkspaceRecord(session, stored.field, storedData)) {
        const branchId = String(storedData.branchId || (stored.field === "branches" ? storedData.id : "") || "").trim();
        if (branchId) authorizedBranchIds.add(branchId);
      }
      const recordIds = new Set([stored.recordId, storedData.id, storedData.taskId, storedData.jobId]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean));
      recordIds.forEach((recordId) => {
        const key = `${stored.field}\u0000${recordId}`;
        if (!existingByFieldAndRecord.has(key)) existingByFieldAndRecord.set(key, []);
        existingByFieldAndRecord.get(key).push({ doc, stored });
      });
    });
    const existingWorkerActiveClocks = new Map();
    if (roleId === "worker") {
      existingSnapshot.docs.forEach((doc) => {
        const stored = doc.data() || {};
        const clock = stored.data || {};
        if (stored.deletedAt
          || stored.field !== "activeClockSessions"
          || !canAccessWorkspaceRecord(session, stored.field, clock, { write: true })) return;
        const clockId = String(stored.recordId || clock.id || "").trim().toLowerCase();
        if (clockId) existingWorkerActiveClocks.set(clockId, { doc, stored, data: clock });
      });
    }
    const incomingActiveClockIds = new Set((Array.isArray(input.activeClockSessions) ? input.activeClockSessions : [])
      .map((record, index) => workspaceRecordId("activeClockSessions", record, index).toLowerCase()));

    const employeeAssignees = [
      ...employeeUserSnapshot.docs.flatMap((doc) => {
        const employee = doc.data() || {};
        if (String(employee.roleId || "").trim() !== "worker"
          || employee.disabled
          || String(employee.status || "active").toLowerCase() !== "active") return [];
        return [{
          contractorId: String(employee.employerContractorId || employee.contractorId || "").trim(),
          identities: new Set([doc.id, employee.uid, employee.email]
            .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))
        }];
      }),
      ...employeeGrantSnapshot.docs.flatMap((doc) => {
        const employee = doc.data() || {};
        const status = String(employee.status || "issued").toLowerCase();
        if (employee.onboardingMode !== "employee_link"
          || !["issued", "active"].includes(status)
          || (status === "issued" && !isFutureIso(employee.expiresAt))) return [];
        return [{
          contractorId: String(employee.employerContractorId || employee.contractorId || "").trim(),
          identities: new Set([doc.id, `invite-${doc.id}`, employee.firebaseUid, employee.email]
            .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))
        }];
      })
    ];

    function assertTaskAssigneeBelongsToContractor(record = {}, storedRecord = null) {
      if (roleId === "worker") return;
      const assigneeId = String(record.assigneeId || "").trim().toLowerCase();
      const assigneeEmail = normalizeEmail(record.assigneeEmail);
      if (!assigneeId && !assigneeEmail) return;
      const storedAssigneeId = String(storedRecord?.assigneeId || "").trim().toLowerCase();
      const storedAssigneeEmail = normalizeEmail(storedRecord?.assigneeEmail);
      const contractorId = String(record.contractorId || "").trim();
      const assignmentChanged = !storedRecord
        || assigneeId !== storedAssigneeId
        || assigneeEmail !== storedAssigneeEmail
        || contractorId !== String(storedRecord.contractorId || "").trim();
      if (!assignmentChanged) return;
      const identities = new Set([assigneeId, assigneeEmail].filter(Boolean));
      const validAssignee = contractorId && employeeAssignees.some((candidate) => candidate.contractorId === contractorId
        && Array.from(identities).every((identity) => candidate.identities.has(identity)));
      if (!validAssignee) {
        const error = new Error("Assign this ticket only to an active or pending employee under the selected contractor profile.");
        error.statusCode = 403;
        throw error;
      }
    }

    function inheritWorkerAssignmentScope(field, record) {
      if (roleId !== "worker" || ["jobBoards", "tasks"].includes(field)) {
        return { data: record, preserveUnscoped: false };
      }
      const references = [
        ...[record.taskId, record.relatedTask].map((id) => ({ field: "tasks", id })),
        ...[record.jobId, record.job, record.relatedJob].map((id) => ({ field: "jobBoards", id }))
      ].filter(({ id }) => String(id || "").trim());
      const scopeSources = new Map();
      references.forEach(({ field: sourceField, id }) => {
        const sourceKey = `${sourceField}\u0000${String(id).trim().toLowerCase()}`;
        const accessibleSources = (existingByFieldAndRecord.get(sourceKey) || [])
          .filter(({ stored }) => !stored.deletedAt
            && canAccessWorkspaceRecord(session, sourceField, stored.data || {}));
        if (accessibleSources.length > 1) {
          const error = new Error("This assignment reference is ambiguous. Ask the employer to select the exact scoped job or task.");
          error.statusCode = 409;
          throw error;
        }
        accessibleSources.forEach((source) => scopeSources.set(source.doc.id, source.stored.data || {}));
      });
      if (!scopeSources.size) return { data: record, preserveUnscoped: false };

      const sourceScopes = new Set(Array.from(scopeSources.values()).map(workspaceRecordScopeKey));
      if (sourceScopes.size > 1) {
        const error = new Error("The selected job and task belong to different workspaces.");
        error.statusCode = 409;
        throw error;
      }
      const source = Array.from(scopeSources.values())[0] || {};
      for (const scopeField of ["franchiseId", "branchId"]) {
        const requested = String(record[scopeField] || "").trim();
        const assigned = String(source[scopeField] || "").trim();
        if (requested && requested !== assigned) {
          const error = new Error("This record cannot be moved outside its assigned workspace.");
          error.statusCode = 403;
          throw error;
        }
      }
      const data = { ...record };
      if (source.franchiseId) data.franchiseId = source.franchiseId;
      else delete data.franchiseId;
      if (source.branchId) data.branchId = source.branchId;
      else delete data.branchId;
      return {
        data,
        preserveUnscoped: workspaceLocationScopeKey(source) === "unscoped"
      };
    }

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
        const preliminaryRecordId = workspaceRecordId(field, cleanedData, sortIndex);
        const recordKey = `${field}\u0000${preliminaryRecordId.toLowerCase()}`;
        const comparisonData = ["worker", "contractor"].includes(roleId)
          ? { ...cleanedData, contractorId: String(session.contractorId || session.user?.contractorId || "").trim() }
          : cleanedData;
        const preliminaryDocumentId = workspaceDocumentId(companyId, field, preliminaryRecordId, comparisonData);
        const matchingRecords = existingByFieldAndRecord.get(recordKey) || [];
        const exactStoredRecord = existingByDocumentId.get(preliminaryDocumentId);
        const scopedMatchingRecords = matchingRecords.filter(({ stored }) => workspaceRecordScopeKey(stored.data || {}) === workspaceRecordScopeKey(comparisonData));
        if (scopedMatchingRecords.filter(({ stored }) => !stored.deletedAt).length > 1) {
          const error = new Error("This record ID is duplicated inside one contractor workspace. Resolve the duplicate before saving.");
          error.statusCode = 409;
          throw error;
        }
        const authorizedStoredRecord = exactStoredRecord && !exactStoredRecord.stored.deletedAt
          ? (canAccessWorkspaceRecord(session, field, exactStoredRecord.stored.data || {}, { write: true }) ? exactStoredRecord : null)
          : scopedMatchingRecords.find(({ stored }) => !stored.deletedAt
            && canAccessWorkspaceRecord(session, field, stored.data || {}, { write: true }));
        if ((exactStoredRecord && !exactStoredRecord.stored.deletedAt && !authorizedStoredRecord)
          || (scopedMatchingRecords.some(({ stored }) => !stored.deletedAt) && !authorizedStoredRecord)) {
          ignoredRecords += 1;
          fieldsWithIgnoredRecords.add(field);
          return;
        }
        let data;
        if (authorizedStoredRecord) {
          data = preserveStoredWorkspaceScope(session, field, authorizedStoredRecord.stored.data || {}, cleanedData);
        } else {
          const inheritedScope = inheritWorkerAssignmentScope(field, cleanedData);
          data = inheritedScope.preserveUnscoped
            ? {
                ...inheritedScope.data,
                contractorId: String(session.contractorId || session.user?.contractorId || "").trim(),
                workerId: String(session.uid || "").trim(),
                workerEmail: normalizeEmail(session.email)
              }
            : scopeWorkspaceRecordForWrite(session, field, inheritedScope.data, authorizedBranchIds);
        }
        if (!canAccessWorkspaceRecord(session, field, data, { write: true })) {
          ignoredRecords += 1;
          fieldsWithIgnoredRecords.add(field);
          return;
        }
        if (roleId === "worker" && field === "activeClockSessions") {
          const startGps = normalizeGps(data.startGps);
          if (!startGps) {
            const error = new Error("A valid GPS position is required to begin a shift.");
            error.statusCode = 400;
            throw error;
          }
          const currentClockDocumentId = authorizedStoredRecord?.doc.id || "";
          const hasAnotherDurableShift = Array.from(existingWorkerActiveClocks.values()).some((clock) => (
            clock.doc.id !== currentClockDocumentId
            && !consumedActiveClockDocumentIds.has(clock.doc.id)
          ));
          if (hasAnotherDurableShift) {
            const error = new Error("This employee already has an active shift. Clock out before starting another.");
            error.statusCode = 409;
            throw error;
          }
          if (!authorizedStoredRecord) {
            data = {
              ...data,
              start: now,
              startGps,
              end: "",
              endGps: null,
              hours: ""
            };
          }
          incomingWorkerActiveClockCount += 1;
          if (incomingWorkerActiveClockCount > 1) {
            const error = new Error("This employee already has an active shift. Clock out before starting another.");
            error.statusCode = 409;
            throw error;
          }
        }
        if (roleId === "worker" && field === "timeEntries" && !authorizedStoredRecord) {
          const timeRecordId = preliminaryRecordId.toLowerCase();
          const activeClock = existingWorkerActiveClocks.get(timeRecordId);
          const endGps = normalizeGps(data.endGps);
          if (!activeClock || consumedActiveClockDocumentIds.has(activeClock.doc.id)) {
            const error = new Error("Clock out from the matching active shift before saving employee time.");
            error.statusCode = 409;
            throw error;
          }
          if (incomingActiveClockIds.has(timeRecordId)) {
            const error = new Error("An active shift cannot remain open after its time entry is completed.");
            error.statusCode = 409;
            throw error;
          }
          const start = String(activeClock.data.start || "").trim();
          const startGps = normalizeGps(activeClock.data.startGps);
          const startMs = Date.parse(start);
          const endMs = Date.parse(now);
          if (!startGps || !endGps || !Number.isFinite(startMs) || startMs > endMs) {
            const error = new Error("The active shift must contain a valid server start and both GPS positions before clock-out.");
            error.statusCode = 400;
            throw error;
          }
          data = {
            ...activeClock.data,
            id: String(activeClock.data.id || preliminaryRecordId).trim(),
            start,
            startGps: activeClock.data.startGps,
            end: now,
            endGps,
            hours: ((endMs - startMs) / 3600000).toFixed(2),
            contractorId: String(session.contractorId || session.user?.contractorId || "").trim(),
            workerId: String(session.uid || "").trim(),
            workerEmail: normalizeEmail(session.email)
          };
          consumedActiveClockDocumentIds.add(activeClock.doc.id);
          operations.push({
            ref: db.collection(COLLECTIONS.workspaceRecords).doc(activeClock.doc.id),
            data: {
              deletedAt: now,
              updatedAt: now,
              updatedByUid: session.uid,
              updatedByEmail: session.email
            }
          });
        }
        if (roleId === "worker" && ["jobBoards", "tasks"].includes(field) && !authorizedStoredRecord) {
          ignoredRecords += 1;
          fieldsWithIgnoredRecords.add(field);
          return;
        }
        const recordId = workspaceRecordId(field, data, sortIndex);
        if (field === "tasks") {
          assertTaskAssigneeBelongsToContractor(data, authorizedStoredRecord?.stored.data || null);
        }
        const computedDocumentId = workspaceDocumentId(companyId, field, recordId, data);
        const documentId = computedDocumentId;
        if (authorizedStoredRecord && authorizedStoredRecord.doc.id !== computedDocumentId) {
          operations.push({
            ref: db.collection(COLLECTIONS.workspaceRecords).doc(authorizedStoredRecord.doc.id),
            data: {
              deletedAt: now,
              updatedAt: now,
              updatedByUid: session.uid,
              updatedByEmail: session.email
            }
          });
        }
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

    if (ignoredRecords) {
      const error = new Error("The workspace update included records outside this account's access. No records were saved.");
      error.statusCode = 403;
      throw error;
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

    if (canDeleteWorkspaceRecords || roleId === "worker") {
      existingSnapshot.docs.forEach((doc) => {
        const stored = doc.data() || {};
        if (!WORKSPACE_ARRAY_FIELD_SET.has(stored.field)) return;
        if (!Object.prototype.hasOwnProperty.call(input, stored.field)) return;
        if (fieldsWithIgnoredRecords.has(stored.field)) return;
        if (incomingDocumentIds.has(doc.id) || consumedActiveClockDocumentIds.has(doc.id) || stored.deletedAt) return;
        if (!canDeleteWorkspaceRecords) return;
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

    const revision = await commitWorkspaceOperations(db, session, operations, {
      baseRevision,
      baseRevisionProvided,
      baseUpdatedAt,
      baseUpdatedAtProvided,
      currentUpdatedAt,
      hasExistingDocuments: activeExistingDocuments.length > 0,
      updatedAt: now
    });
    return {
      savedRecords,
      ignoredRecords,
      updatedAt: now,
      revision
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
    const detectedContentType = detectWorkspaceAssetContentType(buffer);
    const heifFamily = new Set(["image/heic", "image/heif"]);
    const contentTypeMatches = detectedContentType === contentType
      || (heifFamily.has(detectedContentType) && heifFamily.has(contentType));
    if (!detectedContentType || !contentTypeMatches) {
      const error = new Error("The uploaded bytes do not match the declared JPEG, PNG, WebP, HEIC, HEIF, or PDF file type.");
      error.statusCode = 400;
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
      detectedContentType,
      contentVerified: true,
      contentSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
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
    const user = normalizeOsUserRecord(decodedToken.uid, authUser, {
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
        .map((doc) => normalizeOsUserRecord(doc.id, null, doc.data()))
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
      let userRecord = ensured.record || ensured;
      const accessResult = await assertSessionAccess(userRecord, {
        accessCode: String(request.body?.accessCode || "").trim(),
        accessToken: String(request.body?.accessToken || "").trim(),
        grant: ensured.grant || null
      });
      if (!accessResult.ok) return jsonError(response, accessResult.statusCode, accessResult.message);
      if (ensured.grant?.id) {
        userRecord = await activateAccessGrant(
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
    const displayName = normalizeEmployeeDisplayName(request.body?.displayName || request.body?.name);
    if (!displayName) return jsonError(response, 400, "An employee name is required before an invitation can be issued.");
    const employmentTypeResult = parseEmployeeEmploymentType(request.body?.employmentType, "Employee");
    if (!employmentTypeResult.ok) return jsonError(response, 400, employmentTypeResult.message);
    const startDateResult = parseEmployeeStartDate(request.body?.startDate);
    if (!startDateResult.ok) return jsonError(response, 400, startDateResult.message);
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
      .map((doc) => normalizeOsUserRecord(doc.id, null, doc.data()))
      .find((user) => !user.disabled && user.status === "active");
    if (existingActiveUser) {
      if (existingActiveUser.roleId !== "worker" || existingActiveUser.contractorId !== contractorId) {
        return jsonError(response, 409, "This Google email already belongs to a different active platform account.");
      }
      return jsonError(response, 409, "This employee already has an active portal account. Update assignments from the employee profile.");
    }

    const moduleSelection = resolveEmployeeModuleSelection(request.body || {});
    if (!moduleSelection.ok) return jsonError(response, moduleSelection.statusCode, moduleSelection.message);
    const visibleModuleIds = moduleSelection.supplied
      ? moduleSelection.moduleIds
      : Array.from(getSystemPermissions().worker.pages?.allowed || []);
    const assignedJobIds = parseStringList(request.body?.assignedJobIds);
    const assignedTaskIds = parseStringList(request.body?.assignedTaskIds);
    const assignmentValidation = await validateEmployeeAssignmentScope(request.osSession, {
      assignedJobIds,
      assignedTaskIds,
      employeeModuleIds: visibleModuleIds
    });
    if (!assignmentValidation.ok) {
      return jsonError(response, assignmentValidation.statusCode, assignmentValidation.message);
    }
    const token = createToken();
    const now = new Date().toISOString();
    const grant = {
      email,
      displayName,
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
      assignedJobIds,
      assignedTaskIds,
      assignedJobScopeKeys: assignmentValidation.assignedJobScopeKeys,
      assignedTaskScopeKeys: assignmentValidation.assignedTaskScopeKeys,
      phone: String(request.body?.phone || "").trim().slice(0, 40),
      jobTitle: String(request.body?.jobTitle || "Field employee").trim().slice(0, 120),
      employmentType: employmentTypeResult.value,
      startDate: startDateResult.value
    };

    const grantRef = db.collection(COLLECTIONS.accessGrants).doc(employeeInvitationDocumentId(companyId, contractorId, email));
    await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(grantRef);
      const current = currentSnapshot.exists ? (currentSnapshot.data() || {}) : {};
      if (String(current.status || "").toLowerCase() === "active") {
        const error = new Error("This employee invitation is already active. Manage the employee profile instead.");
        error.statusCode = 409;
        throw error;
      }
      transaction.set(grantRef, grant);
    });

    const olderGrants = await db.collection(COLLECTIONS.accessGrants).where("email", "==", email).get();
    for (const doc of olderGrants.docs) {
      if (doc.id === grantRef.id) continue;
      const current = doc.data() || {};
      const currentContractorId = String(current.employerContractorId || current.contractorId || "").trim();
      if (current.onboardingMode === "employee_link"
        && current.status === "issued"
        && String(current.companyId || "default-company").trim() === companyId
        && currentContractorId === contractorId) {
        await db.collection(COLLECTIONS.accessGrants).doc(doc.id).set({
          status: "superseded",
          tokenHash: "",
          updatedAt: now,
          supersededByUid: request.osSession.uid
        }, { merge: true });
      }
    }

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

  router.patch("/api/employee-invitations/:grantId", requireAction("inviteWorkers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const grantId = String(request.params.grantId || "").trim();
    if (!grantId) return jsonError(response, 400, "An employee invitation ID is required.");

    const grantRef = db.collection(COLLECTIONS.accessGrants).doc(grantId);
    const initialSnapshot = await grantRef.get();
    if (!initialSnapshot.exists) return jsonError(response, 404, "Employee invitation not found.");
    const initialGrant = docDataWithId(initialSnapshot);
    const initialValidation = validateIssuedEmployeeGrantMutation(request.osSession, initialGrant);
    if (!initialValidation.ok) {
      return jsonError(response, initialValidation.statusCode, initialValidation.message);
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    const immutableFields = [
      "email", "roleId", "companyId", "franchiseIds", "contractorId",
      "employerUid", "employerEmail", "employerContractorId", "onboardingMode",
      "employmentStatus", "accessScope", "status", "tokenHash", "portalCodeHash",
      "accessCodeId", "expiresAt", "createdByUid", "createdByEmail"
    ];
    if (immutableFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      return jsonError(response, 400, "Invitation identity, employer binding, role, and expiration cannot be changed.");
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, "displayName") || Object.prototype.hasOwnProperty.call(body, "name")) {
      const displayName = normalizeEmployeeDisplayName(body.displayName ?? body.name);
      if (!displayName) return jsonError(response, 400, "An employee name is required.");
      updates.displayName = displayName;
    }
    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      updates.phone = String(body.phone || "").trim().slice(0, 40);
    }
    if (Object.prototype.hasOwnProperty.call(body, "jobTitle")) {
      updates.jobTitle = String(body.jobTitle || "").trim().slice(0, 120);
    }
    if (Object.prototype.hasOwnProperty.call(body, "employmentType")) {
      const employmentTypeResult = parseEmployeeEmploymentType(body.employmentType);
      if (!employmentTypeResult.ok) return jsonError(response, 400, employmentTypeResult.message);
      updates.employmentType = employmentTypeResult.value;
    }
    if (Object.prototype.hasOwnProperty.call(body, "startDate")) {
      const startDateResult = parseEmployeeStartDate(body.startDate);
      if (!startDateResult.ok) return jsonError(response, 400, startDateResult.message);
      updates.startDate = startDateResult.value;
    }
    if (Object.prototype.hasOwnProperty.call(body, "assignedJobIds")) {
      updates.assignedJobIds = parseStringList(body.assignedJobIds);
    }
    if (Object.prototype.hasOwnProperty.call(body, "assignedTaskIds")) {
      updates.assignedTaskIds = parseStringList(body.assignedTaskIds);
    }
    const moduleSelection = resolveEmployeeModuleSelection(body);
    if (!moduleSelection.ok) return jsonError(response, moduleSelection.statusCode, moduleSelection.message);
    if (moduleSelection.supplied) {
      updates.visibleTabIds = moduleSelection.moduleIds;
      updates.visiblePageIds = moduleSelection.moduleIds;
    }
    if (!Object.keys(updates).length) {
      return jsonError(response, 400, "Provide an employee profile, assignment, or module-access update.");
    }
    const nextAssignedJobIds = updates.assignedJobIds || parseStringList(initialGrant.assignedJobIds || []);
    const nextAssignedTaskIds = updates.assignedTaskIds || parseStringList(initialGrant.assignedTaskIds || []);
    const nextEmployeeModuleIds = updates.visiblePageIds || parseStringList(initialGrant.visiblePageIds || initialGrant.visibleTabIds || []);
    const assignmentValidation = await validateEmployeeAssignmentScope(request.osSession, {
      assignedJobIds: nextAssignedJobIds,
      assignedTaskIds: nextAssignedTaskIds,
      employeeModuleIds: nextEmployeeModuleIds
    });
    if (!assignmentValidation.ok) {
      return jsonError(response, assignmentValidation.statusCode, assignmentValidation.message);
    }
    updates.assignedJobScopeKeys = assignmentValidation.assignedJobScopeKeys;
    updates.assignedTaskScopeKeys = assignmentValidation.assignedTaskScopeKeys;

    const now = new Date().toISOString();
    updates.updatedAt = now;
    updates.updatedByUid = request.osSession.uid;
    updates.updatedByEmail = request.osSession.email;
    let updatedGrant = null;
    const applyUpdate = async (snapshot, writer) => {
      if (!snapshot.exists) {
        const error = new Error("Employee invitation not found.");
        error.statusCode = 404;
        throw error;
      }
      const currentGrant = docDataWithId(snapshot);
      const validation = validateIssuedEmployeeGrantMutation(request.osSession, currentGrant);
      if (!validation.ok) {
        const error = new Error(validation.message);
        error.statusCode = validation.statusCode;
        throw error;
      }
      updatedGrant = { ...currentGrant, ...updates };
      await writer(updates);
    };

    try {
      if (typeof db.runTransaction === "function") {
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(grantRef);
          await applyUpdate(currentSnapshot, (data) => transaction.set(grantRef, data, { merge: true }));
        });
      } else {
        const currentSnapshot = await grantRef.get();
        await applyUpdate(currentSnapshot, (data) => grantRef.set(data, { merge: true }));
      }
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 503), error.message || "Unable to update this employee invitation.");
    }

    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_invitation_updated",
      targetType: "access_grant",
      targetId: grantId,
      metadata: {
        updatedFields: Object.keys(updates).filter((field) => !["updatedAt", "updatedByUid", "updatedByEmail"].includes(field)),
        employeeEmail: initialGrant.email,
        employerContractorId: initialGrant.employerContractorId || initialGrant.contractorId || ""
      }
    });
    const publicGrant = { ...updatedGrant };
    delete publicGrant.tokenHash;
    delete publicGrant.portalCodeHash;
    return response.json({ success: true, grant: publicGrant });
  });

  router.delete("/api/employee-invitations/:grantId", requireAction("inviteWorkers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const grantId = String(request.params.grantId || "").trim();
    if (!grantId) return jsonError(response, 400, "An employee invitation ID is required.");
    const grantRef = db.collection(COLLECTIONS.accessGrants).doc(grantId);
    const snapshot = await grantRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "Employee invitation not found.");
    const grant = docDataWithId(snapshot);
    const validation = validateIssuedEmployeeGrantMutation(request.osSession, grant);
    if (!validation.ok) return jsonError(response, validation.statusCode, validation.message);

    const now = new Date().toISOString();
    const updates = {
      status: "revoked",
      tokenHash: "",
      portalCodeHash: "",
      revokedAt: now,
      revokedByUid: request.osSession.uid,
      revokedByEmail: request.osSession.email,
      updatedAt: now
    };
    const applyRevocation = async (currentSnapshot, writer) => {
      if (!currentSnapshot.exists) {
        const error = new Error("Employee invitation not found.");
        error.statusCode = 404;
        throw error;
      }
      const currentGrant = docDataWithId(currentSnapshot);
      const currentValidation = validateIssuedEmployeeGrantMutation(request.osSession, currentGrant);
      if (!currentValidation.ok) {
        const error = new Error(currentValidation.message);
        error.statusCode = currentValidation.statusCode;
        throw error;
      }
      await writer(updates);
    };
    try {
      if (typeof db.runTransaction === "function") {
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(grantRef);
          await applyRevocation(currentSnapshot, (data) => transaction.set(grantRef, data, { merge: true }));
        });
      } else {
        const currentSnapshot = await grantRef.get();
        await applyRevocation(currentSnapshot, (data) => grantRef.set(data, { merge: true }));
      }
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 503), error.message || "Unable to revoke this employee invitation.");
    }
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_invitation_revoked",
      targetType: "access_grant",
      targetId: grantId,
      metadata: {
        employeeEmail: grant.email,
        employerContractorId: grant.employerContractorId || grant.contractorId || ""
      }
    });
    const publicGrant = { ...grant, ...updates };
    delete publicGrant.tokenHash;
    delete publicGrant.portalCodeHash;
    return response.json({ success: true, grant: publicGrant });
  });

  router.patch("/api/employees/:uid/assignments", requireAction("inviteWorkers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const uid = String(request.params.uid || "").trim();
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "Employee account not found.");
    const employee = normalizeOsUserRecord(uid, null, snapshot.data());
    if (employee.roleId !== "worker" || !canViewUserRecord(request.osSession, employee)) {
      return jsonError(response, 403, "You can update only employees assigned to your contractor profile.");
    }
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(request.body || {}, "assignedJobIds")) {
      updates.assignedJobIds = parseStringList(request.body.assignedJobIds);
    }
    if (Object.prototype.hasOwnProperty.call(request.body || {}, "assignedTaskIds")) {
      updates.assignedTaskIds = parseStringList(request.body.assignedTaskIds);
    }
    if (!Object.keys(updates).length) {
      return jsonError(response, 400, "Provide at least one employee assignment update.");
    }
    const nextAssignedJobIds = Object.prototype.hasOwnProperty.call(updates, "assignedJobIds")
      ? updates.assignedJobIds
      : parseStringList(employee.assignedJobIds || []);
    const nextAssignedTaskIds = Object.prototype.hasOwnProperty.call(updates, "assignedTaskIds")
      ? updates.assignedTaskIds
      : parseStringList(employee.assignedTaskIds || []);
    const assignmentValidation = await validateEmployeeAssignmentScope(request.osSession, {
      assignedJobIds: nextAssignedJobIds,
      assignedTaskIds: nextAssignedTaskIds,
      employeeModuleIds: employee.visiblePageIds || employee.visibleTabIds || []
    });
    if (!assignmentValidation.ok) {
      return jsonError(response, assignmentValidation.statusCode, assignmentValidation.message);
    }
    updates.assignedJobScopeKeys = assignmentValidation.assignedJobScopeKeys;
    updates.assignedTaskScopeKeys = assignmentValidation.assignedTaskScopeKeys;
    updates.updatedAt = new Date().toISOString();
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
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const immutableFields = [
      "uid", "email", "roleId", "companyId", "franchiseIds", "contractorId",
      "employerUid", "employerEmail", "employerContractorId", "onboardingMode",
      "employmentStatus", "employmentType", "startDate", "accessScope", "accessExpiresAt", "disabled", "status"
    ];
    if (immutableFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      return jsonError(response, 400, "Employee identity, employer binding, role, access scope, employment type, and start date cannot be changed from this profile.");
    }
    const db = getFirestore();
    const userRef = db.collection(COLLECTIONS.users).doc(request.osSession.uid);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists) return jsonError(response, 404, "Employee account not found.");
    const storedUser = normalizeOsUserRecord(request.osSession.uid, null, userSnapshot.data());
    if (storedUser.disabled || storedUser.status !== "active" || storedUser.employmentStatus !== "active") {
      return jsonError(response, 403, "This employee profile is inactive. Ask the employer to restore access.");
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, "displayName") || Object.prototype.hasOwnProperty.call(body, "name")) {
      const displayName = normalizeEmployeeDisplayName(body.displayName ?? body.name);
      if (!displayName) return jsonError(response, 400, "An employee name is required.");
      updates.displayName = displayName;
    }
    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      updates.phone = String(body.phone || "").trim().slice(0, 40);
    }
    if (Object.prototype.hasOwnProperty.call(body, "jobTitle")) {
      updates.jobTitle = String(body.jobTitle || "").trim().slice(0, 120);
    }
    if (!Object.keys(updates).length) {
      return jsonError(response, 400, "Provide an employee name, phone number, or job-title update.");
    }
    const now = new Date().toISOString();
    updates.updatedAt = now;

    if (updates.displayName && typeof getFirebaseAuth().updateUser === "function") {
      await getFirebaseAuth().updateUser(request.osSession.uid, { displayName: updates.displayName });
    }
    await userRef.set(updates, { merge: true });
    await writeAuditLog(db, {
      actorUid: request.osSession.uid,
      actorRoleId: request.osSession.roleId,
      eventType: "employee_profile_updated",
      targetType: "user",
      targetId: request.osSession.uid,
      metadata: {
        updatedFields: Object.keys(updates).filter((field) => field !== "updatedAt")
      }
    });
    return response.json({ success: true, user: publicUserRecord({ ...storedUser, ...updates }) });
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
    const normalizedTaskId = taskId.toLowerCase();
    const taskDocuments = taskSnapshot.docs.filter((doc) => {
      const stored = doc.data() || {};
      const task = stored.data || {};
      const identifiers = [stored.recordId, task.id, task.taskId]
        .map((value) => String(value || "").trim().toLowerCase());
      return stored.field === "tasks"
        && !stored.deletedAt
        && identifiers.includes(normalizedTaskId)
        && canAccessWorkspaceRecord(request.osSession, "tasks", task);
    });
    if (!taskDocuments.length) return jsonError(response, 404, "The assigned ticket could not be found.");
    if (taskDocuments.length !== 1) {
      return jsonError(response, 409, "This ticket ID is ambiguous across assigned scopes. Ask the employer to assign a unique ticket ID.");
    }
    const [taskDocument] = taskDocuments;
    const storedTask = taskDocument.data() || {};
    const task = storedTask.data || {};
    const user = request.osSession.user || {};
    const assignedByIdentity = (!task.assigneeId || task.assigneeId === request.osSession.uid)
      && (!normalizeEmail(task.assigneeEmail)
        || normalizeEmail(task.assigneeEmail) === normalizeEmail(request.osSession.email));
    const hasExplicitAssignee = Boolean(task.assigneeId || normalizeEmail(task.assigneeEmail));
    if (hasExplicitAssignee && !assignedByIdentity) {
      return jsonError(response, 403, "This ticket is not assigned to the signed-in employee.");
    }
    if (String(task.status || "").trim().toLowerCase() === "complete" || task.ticketSignoffId) {
      return jsonError(response, 409, "This ticket is already complete.");
    }
    const evidenceCandidates = [];
    const evidenceMatchesTask = (photo = {}, asset = {}, evidenceTask = {}) => {
      const sameWorker = asset.workerId === request.osSession.uid
        || normalizeEmail(asset.workerEmail || asset.createdByEmail) === normalizeEmail(request.osSession.email);
      const expectedJobId = String(evidenceTask.relatedJob || evidenceTask.jobId || "").trim();
      const expectedContractorId = String(evidenceTask.contractorId || request.osSession.contractorId || "").trim();
      return String(photo.taskId || "").trim() === taskId
        && String(photo.assetId || "").trim() === String(asset.id || "").trim()
        && asset.companyId === companyId
        && String(asset.taskId || "").trim() === taskId
        && (!expectedJobId || String(asset.jobId || "").trim() === expectedJobId)
        && (!expectedContractorId || String(asset.contractorId || "").trim() === expectedContractorId)
        && sameWorker
        && String(asset.objectPath || "").trim()
        && asset.contentVerified === true
        && String(asset.detectedContentType || "").toLowerCase().startsWith("image/")
        && String(asset.contentType || "").toLowerCase().startsWith("image/");
    };
    if (String(task.moduleKey || "").trim() === "photos") {
      const candidatePhotos = taskSnapshot.docs.map((doc) => {
        const stored = doc.data() || {};
        const photo = stored.data || {};
        return {
          eligible: stored.field === "photoRecords"
          && !stored.deletedAt
          && String(photo.taskId || "").trim() === taskId
          && Boolean(String(photo.assetId || "").trim())
          && canAccessWorkspaceRecord(request.osSession, "photoRecords", photo),
          photo,
          photoDocumentId: doc.id
        };
      }).filter((candidate) => candidate.eligible);
      for (const candidate of candidatePhotos) {
        const assetId = String(candidate.photo.assetId || "").trim();
        const assetSnapshot = await db.collection(COLLECTIONS.workspaceAssets).doc(assetId).get();
        if (!assetSnapshot.exists) continue;
        const asset = { id: assetSnapshot.id, ...(assetSnapshot.data() || {}) };
        if (!evidenceMatchesTask(candidate.photo, asset, task)) continue;
        evidenceCandidates.push({
          photoDocumentId: candidate.photoDocumentId,
          assetId,
          photoRef: db.collection(COLLECTIONS.workspaceRecords).doc(candidate.photoDocumentId),
          assetRef: db.collection(COLLECTIONS.workspaceAssets).doc(assetId)
        });
      }
      if (!evidenceCandidates.length) {
        return jsonError(response, 409, "Upload and save the required photo evidence before signing this ticket.");
      }
    }

    const priorSnapshot = await db.collection(COLLECTIONS.employeeTicketSignoffs)
      .where("employeeUid", "==", request.osSession.uid)
      .get();
    if (priorSnapshot.docs.some((doc) => {
      const prior = doc.data() || {};
      return prior.companyId === companyId
        && (prior.taskDocumentId === taskDocument.id || prior.taskId === taskId);
    })) {
      return jsonError(response, 409, "This employee already signed off the selected ticket.");
    }

    const signedAt = new Date().toISOString();
    const signoffId = hashSecret(`${companyId}\u0000${request.osSession.uid}\u0000${taskDocument.id}`).slice(0, 48);
    const taskRef = db.collection(COLLECTIONS.workspaceRecords).doc(taskDocument.id);
    const signoffRef = db.collection(COLLECTIONS.employeeTicketSignoffs).doc(signoffId);
    const userRef = db.collection(COLLECTIONS.users).doc(request.osSession.uid);
    const revisionRef = db.collection(COLLECTIONS.workspaceRevisions).doc(workspaceRevisionDocumentId(companyId));
    let signoff = null;
    let completedTask = null;
    let workspaceRevision = "";
    try {
      await db.runTransaction(async (transaction) => {
        const [
          currentTaskSnapshot,
          currentSignoffSnapshot,
          _currentRevisionSnapshot,
          currentUserSnapshot,
          ...currentEvidenceSnapshots
        ] = await Promise.all([
          transaction.get(taskRef),
          transaction.get(signoffRef),
          transaction.get(revisionRef),
          transaction.get(userRef),
          ...evidenceCandidates.flatMap((candidate) => [
            transaction.get(candidate.photoRef),
            transaction.get(candidate.assetRef)
          ])
        ]);
        if (!currentTaskSnapshot.exists || currentSignoffSnapshot.exists) {
          throw workspaceConflictError();
        }
        const currentStoredTask = currentTaskSnapshot.data() || {};
        const currentTask = currentStoredTask.data || {};
        const currentIdentifiers = [currentStoredTask.recordId, currentTask.id, currentTask.taskId]
          .map((value) => String(value || "").trim().toLowerCase());
        const currentAssignedByIdentity = (!currentTask.assigneeId || currentTask.assigneeId === request.osSession.uid)
          && (!normalizeEmail(currentTask.assigneeEmail)
            || normalizeEmail(currentTask.assigneeEmail) === normalizeEmail(request.osSession.email));
        const currentHasExplicitAssignee = Boolean(currentTask.assigneeId || normalizeEmail(currentTask.assigneeEmail));
        if (currentStoredTask.deletedAt
          || !currentIdentifiers.includes(normalizedTaskId)
          || !canAccessWorkspaceRecord(request.osSession, "tasks", currentTask)
          || (currentHasExplicitAssignee && !currentAssignedByIdentity)
          || String(currentTask.status || "").trim().toLowerCase() === "complete"
          || currentTask.ticketSignoffId) {
          throw workspaceConflictError();
        }
        const currentEvidence = [];
        evidenceCandidates.forEach((candidate, index) => {
          const photoSnapshot = currentEvidenceSnapshots[index * 2];
          const assetSnapshot = currentEvidenceSnapshots[(index * 2) + 1];
          if (!photoSnapshot?.exists || !assetSnapshot?.exists) return;
          const storedPhoto = photoSnapshot.data() || {};
          const photo = storedPhoto.data || {};
          const asset = { id: assetSnapshot.id, ...(assetSnapshot.data() || {}) };
          if (storedPhoto.deletedAt
            || storedPhoto.field !== "photoRecords"
            || !canAccessWorkspaceRecord(request.osSession, "photoRecords", photo)
            || !evidenceMatchesTask(photo, asset, currentTask)) return;
          currentEvidence.push({
            photoDocumentId: candidate.photoDocumentId,
            assetId: candidate.assetId,
            contentSha256: String(asset.contentSha256 || hashSecret([
              candidate.assetId,
              asset.objectPath,
              asset.size,
              asset.contentType,
              asset.createdAt
            ].join("\u0000"))),
            objectPath: String(asset.objectPath || ""),
            contentType: String(asset.contentType || ""),
            size: Number(asset.size || 0)
          });
        });
        if (String(currentTask.moduleKey || "").trim() === "photos" && !currentEvidence.length) {
          const error = new Error("Photo evidence changed before the ticket could be signed. Reload and verify the upload.");
          error.statusCode = 409;
          throw error;
        }
        const currentUser = currentUserSnapshot.exists ? (currentUserSnapshot.data() || {}) : user;
        const taskFranchiseId = String(currentTask.franchiseId || "").trim();
        const taskBranchId = String(currentTask.branchId || "").trim();
        const taskContractorId = String(currentTask.contractorId || "").trim();
        workspaceRevision = crypto.randomUUID();
        signoff = {
          id: signoffId,
          taskId,
          taskDocumentId: taskDocument.id,
          taskTitle: String(currentTask.title || "Work ticket").slice(0, 240),
          jobId: String(currentTask.relatedJob || currentTask.jobId || "").slice(0, 160),
          companyId,
          franchiseId: taskFranchiseId,
          franchiseIds: taskFranchiseId ? [taskFranchiseId] : [],
          branchId: taskBranchId,
          contractorId: taskContractorId,
          employerUid: String(currentUser.employerUid || "").trim(),
          employerEmail: normalizeEmail(currentUser.employerEmail),
          employerContractorId: String(currentUser.employerContractorId || taskContractorId).trim(),
          employeeUid: request.osSession.uid,
          employeeEmail: normalizeEmail(request.osSession.email),
          employeeName: String(user.displayName || request.osSession.email || "Employee").slice(0, 160),
          typedSignature,
          attested: true,
          gps,
          evidenceAssetIds: currentEvidence.map((evidence) => evidence.assetId),
          evidenceAssets: currentEvidence,
          evidenceDigest: currentEvidence.length
            ? hashSecret(JSON.stringify(currentEvidence.map((evidence) => ({
                assetId: evidence.assetId,
                contentSha256: evidence.contentSha256
              })).sort((left, right) => left.assetId.localeCompare(right.assetId))))
            : "",
          status: "signed",
          signedAt,
          createdAt: signedAt,
          updatedAt: signedAt
        };
        completedTask = {
          ...currentTask,
          status: "Complete",
          signedOffAt: signedAt,
          signedOffByUid: request.osSession.uid,
          signedOffByEmail: request.osSession.email,
          ticketSignoffId: signoffId
        };
        transaction.set(signoffRef, signoff);
        transaction.set(taskRef, {
          data: completedTask,
          updatedAt: signedAt,
          updatedByUid: request.osSession.uid,
          updatedByEmail: request.osSession.email
        }, { merge: true });
        transaction.set(userRef, {
          lastTicketSignoffAt: signedAt,
          updatedAt: signedAt
        }, { merge: true });
        transaction.set(revisionRef, {
          companyId,
          revision: workspaceRevision,
          updatedAt: signedAt,
          updatedByUid: request.osSession.uid,
          updatedByEmail: request.osSession.email
        });
      });
    } catch (error) {
      return jsonError(response, Number(error?.statusCode || 409), error?.message || "This ticket changed before it could be signed. Reload and try again.");
    }
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
    return response.status(201).json({
      success: true,
      signoff,
      workspaceRevision,
      task: completedTask
    });
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
        revision: "",
        workspaceState: {}
      });
    }
    const result = await readWorkspaceState(request.osSession);
    return response.json({ success: true, durable: true, ...result });
  });

  router.put("/api/workspace-state", requireSession, async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    try {
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const result = await writeWorkspaceState(request.osSession, body.workspaceState || {}, {
        baseRevision: body.baseRevision,
        baseRevisionProvided: Object.prototype.hasOwnProperty.call(body, "baseRevision"),
        baseUpdatedAt: body.baseUpdatedAt,
        baseUpdatedAtProvided: Object.prototype.hasOwnProperty.call(body, "baseUpdatedAt")
      });
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
      .map((doc) => normalizeOsUserRecord(doc.id, authMap.get(doc.id), doc.data()))
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
    const assignmentValidation = roleId === "worker"
      ? await validateEmployeeAssignmentScope(request.osSession, {
          assignedJobIds: mutationPayload.assignedJobIds || [],
          assignedTaskIds: mutationPayload.assignedTaskIds || [],
          employeeModuleIds: mutationPayload.visiblePageIds || mutationPayload.visibleTabIds || []
        })
      : { ok: true, assignedJobScopeKeys: [], assignedTaskScopeKeys: [] };
    if (!assignmentValidation.ok) {
      return jsonError(response, assignmentValidation.statusCode, assignmentValidation.message);
    }

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
      assignedTaskIds: mutationPayload.assignedTaskIds || [],
      assignedJobScopeKeys: assignmentValidation.assignedJobScopeKeys,
      assignedTaskScopeKeys: assignmentValidation.assignedTaskScopeKeys
    };
    const grantRef = await db.collection(COLLECTIONS.accessGrants).add(grant);
    const accessLink = buildAccessLink(request, token);
    const userRecord = normalizeOsUserRecord(createdUser.uid, createdUser, {
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
      assignedTaskIds: mutationPayload.assignedTaskIds || [],
      assignedJobScopeKeys: assignmentValidation.assignedJobScopeKeys,
      assignedTaskScopeKeys: assignmentValidation.assignedTaskScopeKeys
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
    if (!canViewUserRecord(request.osSession, normalizeOsUserRecord(uid, null, currentData))) {
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
    if (String(nextRoleId || "").trim() === "worker") {
      const assignmentValidation = await validateEmployeeAssignmentScope(request.osSession, {
        assignedJobIds: Object.prototype.hasOwnProperty.call(updates, "assignedJobIds") ? updates.assignedJobIds : currentData.assignedJobIds,
        assignedTaskIds: Object.prototype.hasOwnProperty.call(updates, "assignedTaskIds") ? updates.assignedTaskIds : currentData.assignedTaskIds,
        employeeModuleIds: updates.visiblePageIds || currentData.visiblePageIds || updates.visibleTabIds || currentData.visibleTabIds || []
      });
      if (!assignmentValidation.ok) {
        return jsonError(response, assignmentValidation.statusCode, assignmentValidation.message);
      }
      updates.assignedJobScopeKeys = assignmentValidation.assignedJobScopeKeys;
      updates.assignedTaskScopeKeys = assignmentValidation.assignedTaskScopeKeys;
    }
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
    if (!canViewUserRecord(request.osSession, normalizeOsUserRecord(uid, null, snapshot.data()))) {
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
    if (!canViewUserRecord(request.osSession, normalizeOsUserRecord(uid, null, snapshot.data()))) {
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
