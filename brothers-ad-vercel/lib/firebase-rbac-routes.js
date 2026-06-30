const fs = require("fs");
const path = require("path");
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
  legacyAdmins: "admins"
};

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
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
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

function buildInviteEmail({ email, displayName, roleId, accessCode, accessLink, expiresAt, createdByEmail }) {
  const name = displayName || email;
  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "48 hours";
  const roleLabel = String(roleId || "contractor").replace(/_/g, " ");
  const subject = "Your Brothers OS access link and code";
  const text = [
    `Hi ${name},`,
    "",
    "You have been invited to Brothers OS.",
    `Access type: ${roleLabel}`,
    `Access link: ${accessLink}`,
    `Access code: ${accessCode}`,
    `Expires: ${expiresLabel}`,
    "",
    "Sign in with the same Google email address that received this invite. Contractors and trial users must enter the access code on the login screen.",
    "",
    "If you did not request this access, ignore this email.",
    createdByEmail ? `Issued by: ${createdByEmail}` : ""
  ].filter(Boolean).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px">Your Brothers OS access is ready</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>You have been invited to Brothers OS. Sign in with the same Google email address that received this invite.</p>
      <p><strong>Access type:</strong> ${escapeHtml(roleLabel)}</p>
      <p><strong>Access code:</strong> <span style="font-size:18px;letter-spacing:1px">${escapeHtml(accessCode)}</span></p>
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

  function buildAccessLink(request, token) {
    const forwardedHost = String(request.get("x-forwarded-host") || request.get("host") || "").trim();
    const forwardedProto = String(request.get("x-forwarded-proto") || request.protocol || "https").split(",")[0];
    const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : "";
    return `${origin}/#access/${encodeURIComponent(token)}`;
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
    const superAdminEmails = new Set(
      String(process.env.SUPER_ADMIN_EMAILS || "david@brothersrestoration.org")
        .split(",")
        .map((item) => normalizeEmail(item))
        .filter(Boolean)
    );
    const normalized = normalizeEmail(email);
    return !isBlockedEmail(normalized) && superAdminEmails.has(normalized);
  }

  function getAllowedLoginEmails() {
    return new Set(
      String(process.env.FIREBASE_ALLOWED_LOGIN_EMAILS || process.env.SUPER_ADMIN_EMAILS || "david@brothersrestoration.org")
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

  async function findLegacyAdmin(db, authUser) {
    if (isBlockedEmail(authUser.email)) return null;
    if (String(process.env.ALLOW_LEGACY_ADMIN_BRIDGE || "").toLowerCase() !== "true") return null;
    const legacyAdminRefs = [
      db.collection(COLLECTIONS.legacyAdmins).doc(authUser.uid),
      db.collection(COLLECTIONS.legacyAdmins).doc(sanitizeEmailKey(authUser.email))
    ];
    const legacyAdminDocs = await Promise.all(legacyAdminRefs.map((ref) => ref.get().catch(() => null)));
    return legacyAdminDocs.find((doc) => doc?.exists)?.data() || null;
  }

  async function findActiveAccessGrant(email, accessToken = "") {
    const db = getFirestore();
    const candidates = [];
    const normalizedEmail = normalizeEmail(email);
    if (accessToken) {
      const tokenSnapshot = await db.collection(COLLECTIONS.accessGrants).where("tokenHash", "==", hashSecret(accessToken)).limit(1).get();
      tokenSnapshot.docs.forEach((doc) => candidates.push(docDataWithId(doc)));
    }

    if (!candidates.length && normalizedEmail) {
      const emailSnapshot = await db.collection(COLLECTIONS.accessGrants).where("email", "==", normalizedEmail).limit(10).get();
      emailSnapshot.docs.forEach((doc) => candidates.push(docDataWithId(doc)));
    }

    return candidates.find((grant) => {
      const status = String(grant.status || "issued").toLowerCase();
      return grant.email === normalizedEmail
        && ["issued", "active"].includes(status)
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

  function assertAccessCode(userRecord, accessCode, grant = null) {
    const requiredHash = grant?.portalCodeHash || userRecord.portalCodeHash || "";
    if (!requiredHash) return { ok: true };
    if (requiredHash !== hashSecret(String(accessCode || "").trim().toUpperCase())) {
      return { ok: false, statusCode: 403, message: "A valid contractor access code is required for this portal." };
    }
    return { ok: true };
  }

  async function assertSessionAccess(userRecord, options = {}) {
    const roleId = String(userRecord.roleId || "").trim();
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
    if (roleId === "contractor") {
      return assertAccessCode(userRecord, options.accessCode, options.grant);
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
    const [legacyAdmin, accessGrant] = await Promise.all([
      findLegacyAdmin(db, authUser),
      findActiveAccessGrant(email, options.accessToken)
    ]);
    const legacyRole = String(legacyAdmin?.role || "").toLowerCase();
    const isLegacyAdmin = legacyRole === "super_admin";
    const loginEmailAllowed = !isOwnerOnlyLoginEnabled() || getAllowedLoginEmails().has(email);
    const isSuper = loginEmailAllowed && (isSuperAdminEmail(email) || isLegacyAdmin);

    if (snapshot.exists) {
      const existing = normalizeUserRecord(decodedToken.uid, authUser, snapshot.data());
      const merged = isSuper
        ? { ...existing, roleId: "super_admin", disabled: false, status: "active" }
        : accessGrant
          ? { ...existing, ...buildGrantUserFields(accessGrant) }
          : existing;
      await userRef.set({ ...merged, updatedAt: new Date().toISOString() }, { merge: true });
      await auth.setCustomUserClaims(decodedToken.uid, {
        roleId: merged.roleId,
        companyId: merged.companyId,
        franchiseIds: merged.franchiseIds,
        contractorId: merged.contractorId || "",
        accessExpiresAt: merged.accessExpiresAt || ""
      });
      if (accessGrant) {
        await db.collection(COLLECTIONS.accessGrants).doc(accessGrant.id).set({
          status: "active",
          activatedAt: new Date().toISOString(),
          firebaseUid: decodedToken.uid,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
      return { record: merged, grant: accessGrant };
    }

    const baseRecord = isSuper
      ? { roleId: "super_admin", disabled: false, status: "active" }
      : accessGrant
        ? buildGrantUserFields(accessGrant)
        : { roleId: "worker", disabled: true, status: "pending_access", accessScope: "unapproved" };
    const record = normalizeUserRecord(decodedToken.uid, authUser, baseRecord);
    await userRef.set(record, { merge: true });
    await auth.setCustomUserClaims(decodedToken.uid, {
      roleId: record.roleId,
      companyId: record.companyId,
      franchiseIds: record.franchiseIds,
      contractorId: record.contractorId || "",
      accessExpiresAt: record.accessExpiresAt || ""
    });
    if (accessGrant) {
      await db.collection(COLLECTIONS.accessGrants).doc(accessGrant.id).set({
        status: "active",
        activatedAt: new Date().toISOString(),
        firebaseUid: decodedToken.uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
    return { record, grant: accessGrant };
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
      const emailResult = assertAllowedLoginEmail(decoded.email);
      if (!emailResult.ok) return { ok: false, statusCode: emailResult.statusCode, message: emailResult.message };
      if (!firebaseAdminDataStoreConfigured()) {
        return {
          ok: true,
          session: buildFallbackSuperAdminSession(decoded)
        };
      }
      const ensured = await ensureUserRecord(decoded);
      const userRecord = ensured.record || ensured;
      if (userRecord.accessExpiresAt && !isFutureIso(userRecord.accessExpiresAt)) {
        return { ok: false, statusCode: 401, message: "Authentication session is invalid or expired." };
      }
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
          user: userRecord
        }
      };
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
      if (!sessionResult.session.permissions?.actions?.[actionName]) {
        return jsonError(response, 403, "You do not have permission to perform this action.");
      }
      request.osSession = sessionResult.session;
      return next();
    };
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

  function firebaseAdminDataStoreConfigured() {
    return Boolean(getFirestore());
  }

  function adminDataStoreRequired(response) {
    return jsonError(response, 503, "Firebase admin credentials are required for persistent user management, invite links, access codes, and communication-board writes.");
  }

  function buildFallbackSuperAdminSession(decodedToken) {
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
      accessExpiresAt: hoursFromNow(48)
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
      user: session.user,
      session: {
        uid: session.uid,
        email: session.email,
        roleId: session.roleId,
        companyId: session.companyId,
        franchiseIds: session.franchiseIds,
        contractorId: session.contractorId || "",
        accessExpiresAt: session.accessExpiresAt || "",
        accessScope: session.accessScope || "",
        permissions: session.permissions
      },
      roles: getSystemRoles(),
      permissions: permissionDocs,
      tabs: filterCollectionByPermission(seeds.tabs, session.permissions, "tabs"),
      pages: filterCollectionByPermission(seeds.pages, session.permissions, "pages"),
      pageSections: filterCollectionByPermission(seeds.sections, session.permissions, "sections"),
      companySettings: getDefaultCompanySettings(),
      franchiseSettings: [getDefaultFranchiseSettings()],
      users: [session.user],
      auditLogs: [],
      businessData,
      accessRequests: [],
      accessGrants: [],
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
    const canUseCommunity = session.permissions?.actions?.postCommunityMessages;
    const [tabsSnapshot, pagesSnapshot, sectionsSnapshot, companySnapshot, rolesSnapshot, permissionsSnapshot, franchiseSnapshot, usersSnapshot, auditSnapshot, businessSnapshot, accessRequestsSnapshot, accessGrantsSnapshot, communitySnapshot] = await Promise.all([
      db.collection(COLLECTIONS.tabs).orderBy("order").get(),
      db.collection(COLLECTIONS.pages).orderBy("order").get(),
      db.collection(COLLECTIONS.pageSections).orderBy("pageId").orderBy("order").get(),
      db.collection(COLLECTIONS.companySettings).doc("default").get(),
      db.collection(COLLECTIONS.roles).orderBy("rank", "desc").get(),
      db.collection(COLLECTIONS.permissions).get(),
      session.companyId ? db.collection(COLLECTIONS.franchiseSettings).get() : Promise.resolve({ docs: [] }),
      session.permissions?.actions?.manageUsers ? db.collection(COLLECTIONS.users).get() : Promise.resolve({ docs: [] }),
      session.permissions?.actions?.viewAuditLogs ? db.collection(COLLECTIONS.auditLogs).orderBy("createdAt", "desc").limit(200).get() : Promise.resolve({ docs: [] }),
      canReadBusinessData ? db.collection(COLLECTIONS.businessRecords).get() : Promise.resolve({ docs: [] }),
      canManageAccess ? db.collection(COLLECTIONS.accessRequests).orderBy("requestedAt", "desc").limit(100).get() : Promise.resolve({ docs: [] }),
      canManageAccess ? db.collection(COLLECTIONS.accessGrants).orderBy("createdAt", "desc").limit(100).get() : Promise.resolve({ docs: [] }),
      canUseCommunity ? db.collection(COLLECTIONS.communityPosts).orderBy("createdAt", "desc").limit(100).get() : Promise.resolve({ docs: [] })
    ]);

    const tabs = filterCollectionByPermission(
      tabsSnapshot.docs.map((doc) => doc.data()).filter((tab) => tab.visible !== false),
      session.permissions,
      "tabs"
    );
    const pages = filterCollectionByPermission(
      pagesSnapshot.docs.map((doc) => doc.data()).filter((page) => page.visible !== false),
      session.permissions,
      "pages"
    );
    const visiblePageIds = new Set(pages.map((page) => page.id));
    const sections = filterCollectionByPermission(
      sectionsSnapshot.docs.map((doc) => doc.data()).filter((section) => visiblePageIds.has(section.pageId) && section.visible !== false),
      session.permissions,
      "sections"
    );

    return {
      user: session.user,
      session: {
        uid: session.uid,
        email: session.email,
        roleId: session.roleId,
        companyId: session.companyId,
        franchiseIds: session.franchiseIds,
        contractorId: session.contractorId || "",
        accessExpiresAt: session.accessExpiresAt || "",
        accessScope: session.accessScope || "",
        permissions: session.permissions
      },
      roles: rolesSnapshot.docs.map((doc) => doc.data()),
      permissions: permissionsSnapshot.docs.map((doc) => doc.data()),
      tabs,
      pages,
      pageSections: sections,
      companySettings: companySnapshot.exists ? companySnapshot.data() : getDefaultCompanySettings(),
      franchiseSettings: franchiseSnapshot.docs.map((doc) => doc.data()),
      users: usersSnapshot.docs.map((doc) => doc.data()),
      auditLogs: auditSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      businessData: businessSnapshot.docs.map(docDataWithId).filter((record) => canViewBusinessRecord(session, record)),
      accessRequests: accessRequestsSnapshot.docs.map(docDataWithId),
      accessGrants: accessGrantsSnapshot.docs.map((doc) => {
        const grant = docDataWithId(doc);
        delete grant.tokenHash;
        delete grant.portalCodeHash;
        return grant;
      }),
      communityPosts: communitySnapshot.docs.map(docDataWithId)
    };
  }

  router.get("/api/auth/config", (_request, response) => {
    const sessionTtlMs = getSessionTtlMs();
    return response.json({
      success: true,
      firebase: {
        ...getFirebasePublicConfig(),
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
      const emailResult = assertAllowedLoginEmail(decoded.email);
      if (!emailResult.ok) return jsonError(response, emailResult.statusCode, emailResult.message);
      if (!firebaseAdminDataStoreConfigured()) {
        const expiresIn = getSessionTtlMs();
        const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
        response.cookie(sessionCookieName, sessionCookie, getCookieOptions(request, expiresIn));
        const session = buildFallbackSuperAdminSession(decoded);
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
            accessScope: session.accessScope || ""
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
          accessScope: userRecord.accessScope || ""
        }
      });
    } catch (error) {
      return jsonError(response, 401, error.message || "Unable to establish a Firebase session.");
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
    const context = await buildAccessContext(request.osSession);
    return response.json({ success: true, ...context });
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
      portalCodeHash: hashSecret(accessCode),
      accessCodeId,
      expiresAt: hoursFromNow(ttlHours),
      createdAt: now,
      updatedAt: now,
      createdByUid: request.osSession.uid,
      createdByEmail: request.osSession.email,
      requestId: String(request.body?.requestId || "").trim()
    };
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
    if (!firebaseAdminDataStoreConfigured()) return response.json({ success: true, users: [request.osSession.user] });
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const [firestoreUsers, authUsers] = await Promise.all([
      db.collection(COLLECTIONS.users).get(),
      auth.listUsers(1000)
    ]);
    const authMap = new Map(authUsers.users.map((user) => [user.uid, user]));
    const users = firestoreUsers.docs.map((doc) => normalizeUserRecord(doc.id, authMap.get(doc.id), doc.data()));
    return response.json({ success: true, users });
  });

  router.post("/api/rbac/users", requireAction("manageUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const email = String(request.body?.email || "").trim().toLowerCase();
    const password = String(request.body?.password || "").trim();
    const displayName = String(request.body?.displayName || request.body?.name || email).trim();
    const roleId = String(request.body?.roleId || "worker").trim();
    const accessCode = String(request.body?.accessCode || "").trim();

    if (!email || !password) return jsonError(response, 400, "Email and password are required.");

    const createdUser = await auth.createUser({
      email,
      password,
      displayName,
      disabled: false
    });
    const userRecord = normalizeUserRecord(createdUser.uid, createdUser, {
      roleId,
      companyId: String(request.body?.companyId || "default-company"),
      franchiseIds: Array.isArray(request.body?.franchiseIds) ? request.body.franchiseIds : [],
      contractorId: String(request.body?.contractorId || "").trim(),
      accessExpiresAt: request.body?.accessExpiresAt ? toIso(request.body.accessExpiresAt) : "",
      accessScope: String(request.body?.accessScope || "").trim(),
      portalCodeHash: accessCode ? hashSecret(accessCode.toUpperCase()) : "",
      status: "active"
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
    return response.status(201).json({ success: true, user: userRecord });
  });

  router.patch("/api/rbac/users/:uid", requireAction("manageUsers"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const auth = getFirebaseAuth();
    const db = getFirestore();
    const uid = request.params.uid;
    const updates = request.body && typeof request.body === "object" ? { ...request.body } : {};
    if (typeof updates.accessCode === "string" && updates.accessCode.trim()) {
      updates.portalCodeHash = hashSecret(updates.accessCode.trim().toUpperCase());
      updates.accessCodeId = `manual-${crypto.randomBytes(4).toString("hex")}`;
    }
    delete updates.accessCode;
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const snapshot = await userRef.get();
    if (!snapshot.exists) return jsonError(response, 404, "User not found.");

    const nextData = {
      ...snapshot.data(),
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
      metadata: updates
    });

    return response.json({ success: true, user: nextData });
  });

  router.post("/api/rbac/users/:uid/reset-permissions", requireAction("resetPermissions"), async (request, response) => {
    if (!firebaseAdminDataStoreConfigured()) return adminDataStoreRequired(response);
    const db = getFirestore();
    const uid = request.params.uid;
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

  router.post("/api/rbac/assets", requireAction("uploadImages"), async (request, response) => {
    const fileName = String(request.body?.fileName || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const base64 = String(request.body?.base64 || "");
    if (!base64) return jsonError(response, 400, "A base64 image payload is required.");
    const uploadsDir = path.join(__dirname, "..", "uploads", "os-assets");
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = `${Date.now()}-${fileName}`;
    const filePath = path.join(uploadsDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    return response.status(201).json({
      success: true,
      assetUrl: `/uploads/os-assets/${safeName}`
    });
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
