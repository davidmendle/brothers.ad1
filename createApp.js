const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const {
  getFirebaseAuth,
  getFirebasePublicConfig,
  getFirestore,
  isFirebaseConfigured
} = require("./lib/firebase-admin");
const { createFirebaseRbacRouter } = require("./lib/firebase-rbac-routes");

const rootDir = __dirname;
const runtimeDataRoot = process.env.VERCEL
  ? path.join("/tmp", "brothers-os-runtime")
  : rootDir;
const uploadsRoot = path.join(runtimeDataRoot, "uploads");
const insuranceUploadsRoot = path.join(uploadsRoot, "insurance-intake");
const adminSessionCookieName = "brothers_admin_session";
const adminSessionIssuer = "brothers-os";
const adminSessionDurationMs = 1000 * 60 * 60 * 12;
const allowedStatuses = ["new", "reviewed", "in-progress", "completed", "rejected"];
const blobSubmissionPrefix = "insurance-intake/submissions";
const blobFilePrefix = "insurance-intake/files";
const placeholderWebsiteOrigin = "https://YOUR-MAIN-WEBSITE-DOMAIN.com";
const defaultAllowedWebsiteOrigin = "https://www.brothersrestoration.org";
const defaultOsBaseUrl = "https://brothers.ad";
const defaultLegacyAliasHost = "updated-ui-brs-site.vercel.app";
const defaultLegacyOsBaseUrl = "https://updated-os-systems-nu.vercel.app";
const defaultAdminEmails = ["david@brothersrestoration.org"];
const defaultBlockedAdminEmails = [
  "chaim@brothersrestoration.org",
  "reznikchaim@gmail.com"
];
const requiredFieldLabels = {
  fullName: "Full name",
  phone: "Phone number",
  email: "Email",
  propertyAddress: "Property address",
  insuranceCompanyName: "Insurance company name",
  claimNumber: "Claim number",
  policyNumber: "Policy number",
  damageDescription: "Description of damage"
};

let db;
let blobSdkPromise;
let DatabaseSyncCtor;
const rateLimitBuckets = new Map();

function getDatabaseSyncCtor() {
  if (!DatabaseSyncCtor) {
    const nativeRequire = eval("require");
    DatabaseSyncCtor = nativeRequire("node:sqlite").DatabaseSync;
  }
  return DatabaseSyncCtor;
}

function clientRateLimitKey(request, bucketName) {
  const forwardedFor = String(request.get?.("x-forwarded-for") || "").split(",")[0].trim();
  return `${bucketName}:${forwardedFor || request.ip || request.socket?.remoteAddress || "unknown"}`;
}

function rateLimit(bucketName, options = {}) {
  const windowMs = Number(options.windowMs || 15 * 60 * 1000);
  const max = Number(options.max || 20);
  return (request, response, next) => {
    const now = Date.now();
    const key = clientRateLimitKey(request, bucketName);
    const current = rateLimitBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      return jsonError(response, 429, "Too many requests. Wait a few minutes and try again.");
    }
    return next();
  };
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getStorageBackend() {
  return hasBlobStorage() ? "vercel-blob" : "sqlite-file";
}

function getInsuranceApiKey() {
  return String(process.env.INSURANCE_API_KEY || "").trim();
}

function buildFallbackAdminPassword(apiKey) {
  if (!apiKey || apiKey === "replace_me") return "";
  return `brs-admin-${crypto.createHash("sha256").update(`admin-password:${apiKey}`).digest("hex").slice(0, 24)}`;
}

function buildFallbackAdminSecret(apiKey) {
  if (!apiKey || apiKey === "replace_me") return "";
  return crypto.createHash("sha256").update(`admin-secret:${apiKey}`).digest("hex");
}

function resolveDatabasePath() {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  if (!url.startsWith("file:")) {
    throw new Error("Only SQLite file: DATABASE_URL values are supported unless Vercel Blob storage is configured.");
  }

  const rawPath = url.slice("file:".length);
  if (!rawPath) throw new Error("DATABASE_URL must include a SQLite file path.");
  if (path.isAbsolute(rawPath)) return rawPath;
  return process.env.VERCEL
    ? path.join(runtimeDataRoot, rawPath)
    : path.join(rootDir, rawPath);
}

function getDatabase() {
  if (hasBlobStorage()) return null;

  if (!db) {
    const databasePath = resolveDatabasePath();
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const DatabaseSync = getDatabaseSyncCtor();
    db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_submissions (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        property_address TEXT NOT NULL,
        insurance_company_name TEXT NOT NULL,
        claim_number TEXT NOT NULL,
        policy_number TEXT NOT NULL,
        damage_description TEXT NOT NULL,
        uploaded_files TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'new',
        internal_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

function ensureStorageDirectories() {
  fs.mkdirSync(insuranceUploadsRoot, { recursive: true });
}

function jsonError(response, statusCode, message) {
  response.status(statusCode).json({
    success: false,
    message
  });
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
  return cleaned.slice(-120) || "upload";
}

function parseBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return "";
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), "=") : normalized;
  return Buffer.from(padded, "base64").toString("utf8");
}

function signValue(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getAllowedWebsiteOrigin() {
  return String(process.env.ALLOWED_WEBSITE_ORIGIN || "").trim() || defaultAllowedWebsiteOrigin;
}

function getRequestHost(request) {
  return String(request.get("host") || "")
    .trim()
    .toLowerCase()
    .split(":")[0];
}

function getLegacyInsuranceProxyTargetUrl() {
  const explicitTargetUrl = String(process.env.LEGACY_INSURANCE_PROXY_TARGET_URL || "").trim();
  if (explicitTargetUrl) return explicitTargetUrl;

  const fallbackBaseUrl = getLegacyProxyBaseUrl();
  return fallbackBaseUrl ? `${fallbackBaseUrl}/api/insurance-intake` : "";
}

function getLegacyProxyBaseUrl() {
  if (String(process.env.ENABLE_LEGACY_PROXY || "").toLowerCase() !== "true") return "";

  const explicitBaseUrl = String(process.env.LEGACY_PROXY_BASE_URL || "").trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/g, "");

  const explicitTargetUrl = String(process.env.LEGACY_INSURANCE_PROXY_TARGET_URL || "").trim();
  if (explicitTargetUrl) {
    try {
      return new URL(explicitTargetUrl).origin;
    } catch (_error) {
      return "";
    }
  }

  return process.env.VERCEL ? defaultLegacyOsBaseUrl : "";
}

function getLegacyInsuranceProxyHosts() {
  const explicitHosts = String(process.env.LEGACY_INSURANCE_PROXY_HOSTS || "").trim();
  if (!explicitHosts) return new Set(process.env.VERCEL ? [defaultLegacyAliasHost] : []);

  return new Set(
    explicitHosts
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isLegacyInsuranceProxyUrl(value) {
  if (!value) return false;

  try {
    return getLegacyInsuranceProxyHosts().has(new URL(value).host.toLowerCase());
  } catch (_error) {
    return false;
  }
}

function getConfiguredOsBaseUrl() {
  return String(process.env.OS_BASE_URL || "").trim() || (process.env.VERCEL ? defaultOsBaseUrl : "");
}

function getOsBaseUrl(request) {
  return getConfiguredOsBaseUrl() || `${request.protocol}://${request.get("host")}`;
}

function shouldUseLegacyProxyFallback(request) {
  if (!getLegacyProxyBaseUrl()) return false;
  if (getRequestHost(request) !== defaultLegacyAliasHost) return false;
  return !getInsuranceApiKey() || !getAdminAuthConfig().configured;
}

function shouldProxyLegacyInsuranceIntake(request) {
  const targetUrl = getLegacyInsuranceProxyTargetUrl();
  if (!targetUrl) return false;
  const requestHost = getRequestHost(request);
  return getLegacyInsuranceProxyHosts().has(requestHost) && (
    shouldUseLegacyProxyFallback(request) || String(process.env.LEGACY_INSURANCE_PROXY_HOSTS || "").trim() !== ""
  );
}

function shouldProxyLegacyAdminApi(request) {
  return String(process.env.ENABLE_LEGACY_ADMIN_PROXY || "").toLowerCase() === "true"
    && shouldUseLegacyProxyFallback(request)
    && !getAdminAuthConfig().configured;
}

function getFileDownloadPath(submissionId, fileId) {
  return `/api/insurance-intake/${submissionId}/files/${fileId}`;
}

function getInsurancePublicConfig(request) {
  return {
    success: true,
    config: {
      intakeEnabled: true,
      uploadUrl: `${getOsBaseUrl(request)}/api/insurance-intake`,
      adminLoginUrl: `${getOsBaseUrl(request)}/#module/insurance`,
      maxFiles: 10,
      maxFileSizeBytes: 15 * 1024 * 1024,
      allowedOrigin: getAllowedWebsiteOrigin()
    }
  };
}

function getHealthStatus(request) {
  const resolvedInsuranceApiKey = getInsuranceApiKey();
  const adminConfig = getAdminAuthConfig();
  const firebaseConfig = getFirebasePublicConfig();
  const allowedOrigin = getAllowedWebsiteOrigin();
  const storageDurable = hasBlobStorage();
  const configuredOsBaseUrl = getConfiguredOsBaseUrl();
  const uploadUrl = `${getOsBaseUrl(request)}/api/insurance-intake`;
  const warnings = [];

  if (!resolvedInsuranceApiKey || resolvedInsuranceApiKey === "replace_me") {
    warnings.push("INSURANCE_API_KEY is missing or still set to the placeholder value.");
  }

  if (!adminConfig.configured) {
    warnings.push("Admin dashboard authentication is not fully configured. Set ADMIN_EMAILS, ADMIN_PASSWORD, and ADMIN_JWT_SECRET.");
  }

  if (allowedOrigin === placeholderWebsiteOrigin) {
    warnings.push("ALLOWED_WEBSITE_ORIGIN is still using the placeholder domain.");
  }

  if (!storageDurable) {
    warnings.push("Insurance submissions are using sqlite-file storage. Configure BLOB_READ_WRITE_TOKEN for durable production storage on Vercel.");
  }

  if (isLegacyInsuranceProxyUrl(configuredOsBaseUrl)) {
    warnings.push("OS_BASE_URL points to a legacy intake alias. Update it to the current live OS domain before relying on public-config or health output.");
  }

  if (!firebaseConfig.adminConfigured || !firebaseConfig.webConfigured) {
    warnings.push(`Firebase auth/RBAC is not fully configured. Missing admin env: ${firebaseConfig.missingAdminEnv.join(", ") || "none"}. Missing web env: ${firebaseConfig.missingWebEnv.join(", ") || "none"}.`);
  }

  return {
    success: true,
    service: "brothers-os",
    firebaseAuth: {
      configured: firebaseConfig.enabled,
      adminConfigured: firebaseConfig.adminConfigured,
      webConfigured: firebaseConfig.webConfigured,
      projectId: firebaseConfig.projectId || null,
      missingAdminEnv: firebaseConfig.missingAdminEnv,
      missingWebEnv: firebaseConfig.missingWebEnv
    },
    insuranceIntake: {
      intakeEnabled: true,
      apiKeyConfigured: Boolean(resolvedInsuranceApiKey && resolvedInsuranceApiKey !== "replace_me"),
      adminConfigured: adminConfig.configured,
      adminEmailsConfigured: adminConfig.emails.length,
      allowedOrigin,
      allowedOriginConfigured: allowedOrigin !== placeholderWebsiteOrigin,
      osBaseUrlConfigured: Boolean(configuredOsBaseUrl),
      osBaseUrl: configuredOsBaseUrl || `${request.protocol}://${request.get("host")}`,
      uploadUrl,
      storageBackend: getStorageBackend(),
      storageDurable,
      legacyProxyMode: shouldProxyLegacyInsuranceIntake(request),
      warnings
    }
  };
}

function getAdminAuthConfig() {
  const apiKey = getInsuranceApiKey();
  const configuredEmails = String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .filter((email) => !isBlockedAdminEmail(email));
  const allowDerivedFallback =
    String(process.env.ALLOW_DERIVED_ADMIN_FALLBACK || "").toLowerCase() === "true" && !process.env.VERCEL;
  const emails = configuredEmails.length ? configuredEmails : (allowDerivedFallback && apiKey ? defaultAdminEmails : []);
  const password = String(process.env.ADMIN_PASSWORD || "").trim() || (allowDerivedFallback ? buildFallbackAdminPassword(apiKey) : "");
  const secret = String(process.env.ADMIN_JWT_SECRET || "").trim() || (allowDerivedFallback ? buildFallbackAdminSecret(apiKey) : "");
  const sessionTtlMs = Number(process.env.ADMIN_SESSION_TTL_MS || adminSessionDurationMs);
  const configured = Boolean(emails.length && password && secret);

  return {
    configured,
    email: emails[0] || "",
    emails,
    password,
    secret,
    sessionTtlMs: Number.isFinite(sessionTtlMs) && sessionTtlMs > 0 ? sessionTtlMs : adminSessionDurationMs
  };
}

function getBlockedAdminEmails() {
  return new Set([
    ...defaultBlockedAdminEmails,
    ...String(process.env.BLOCKED_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ]);
}

function isBlockedAdminEmail(email) {
  return getBlockedAdminEmails().has(String(email || "").trim().toLowerCase());
}

function createAdminSessionToken(payload, secret) {
  const headerSegment = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(`${headerSegment}.${payloadSegment}`, secret);
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

function verifyAdminSessionToken(token, secret) {
  if (!token || !secret) return { ok: false, message: "Missing session token." };

  const [headerSegment, payloadSegment, signature] = String(token).split(".");
  if (!headerSegment || !payloadSegment || !signature) {
    return { ok: false, message: "Malformed session token." };
  }

  const expectedSignature = signValue(`${headerSegment}.${payloadSegment}`, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return { ok: false, message: "Invalid session token signature." };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment));
    if (payload.iss !== adminSessionIssuer || payload.role !== "admin") {
      return { ok: false, message: "Invalid session token payload." };
    }
    if (!payload.exp || Date.now() >= Number(payload.exp)) {
      return { ok: false, message: "Session token expired." };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, message: "Invalid session token payload." };
  }
}

function getAdminSessionCookieOptions(request, maxAgeMs) {
  const forceSecureCookies = process.env.ADMIN_COOKIE_SECURE === "true";
  const disableSecureCookies = process.env.ADMIN_COOKIE_SECURE === "false";
  const secure = disableSecureCookies ? false : (forceSecureCookies || request.secure || request.get("x-forwarded-proto") === "https");

  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: maxAgeMs
  };
}

function clearAdminSessionCookie(response, request) {
  response.clearCookie(adminSessionCookieName, {
    ...getAdminSessionCookieOptions(request, 0),
    maxAge: undefined
  });
}

function authenticateAdminCredentials(email, password) {
  const config = getAdminAuthConfig();
  if (!config.configured) {
    return { ok: false, statusCode: 500, message: "Admin authentication is not configured." };
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    return { ok: false, statusCode: 400, message: "Email and password are required." };
  }

  const emailMatches = config.emails.some((configuredEmail) => timingSafeEqualString(normalizedEmail, configuredEmail));
  if (!emailMatches || !timingSafeEqualString(normalizedPassword, config.password)) {
    return { ok: false, statusCode: 401, message: "Invalid admin credentials." };
  }

  return {
    ok: true,
    config,
    email: normalizedEmail
  };
}

function issueAdminSession(response, request, adminEmail) {
  const config = getAdminAuthConfig();
  const now = Date.now();
  const token = createAdminSessionToken(
    {
      sub: adminEmail,
      role: "admin",
      iss: adminSessionIssuer,
      iat: now,
      exp: now + config.sessionTtlMs
    },
    config.secret
  );

  response.cookie(adminSessionCookieName, token, getAdminSessionCookieOptions(request, config.sessionTtlMs));
  return {
    email: adminEmail,
    expiresAt: new Date(now + config.sessionTtlMs).toISOString()
  };
}

function readAdminSession(request) {
  const config = getAdminAuthConfig();
  if (!config.configured) {
    return { ok: false, statusCode: 500, message: "Admin authentication is not configured." };
  }

  const cookies = parseCookies(request.get("cookie"));
  const token = cookies[adminSessionCookieName];
  if (!token) {
    return { ok: false, statusCode: 401, message: "Authentication required." };
  }

  const verification = verifyAdminSessionToken(token, config.secret);
  if (!verification.ok) {
    return { ok: false, statusCode: 401, message: "Authentication required." };
  }

  return {
    ok: true,
    session: {
      email: verification.payload.sub,
      role: verification.payload.role,
      issuedAt: new Date(verification.payload.iat).toISOString(),
      expiresAt: new Date(verification.payload.exp).toISOString()
    }
  };
}

function validateSubmissionPayload(payload) {
  const normalized = {
    fullName: String(payload.fullName || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    propertyAddress: String(payload.propertyAddress || "").trim(),
    insuranceCompanyName: String(payload.insuranceCompanyName || payload.insuranceCompany || "").trim(),
    claimNumber: String(payload.claimNumber || "").trim(),
    policyNumber: String(payload.policyNumber || "").trim(),
    damageDescription: String(payload.damageDescription || payload.description || "").trim()
  };

  const emptySubmission = Object.values(normalized).every((value) => !value);
  if (emptySubmission) {
    return { valid: false, message: "Submission cannot be empty." };
  }

  const missingFields = Object.entries(requiredFieldLabels)
    .filter(([fieldName]) => !normalized[fieldName])
    .map(([, label]) => label);

  if (missingFields.length) {
    return { valid: false, message: `Missing required fields: ${missingFields.join(", ")}.` };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized.email)) {
    return { valid: false, message: "Please provide a valid email address." };
  }

  return { valid: true, normalized };
}

function normalizeInsurancePayloadAliases(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  return {
    ...payload,
    insuranceCompanyName: payload.insuranceCompanyName || payload.insuranceCompany || "",
    damageDescription: payload.damageDescription || payload.description || ""
  };
}

function normalizeUploadedFiles(request) {
  return (request.files || []).map((file) => ({
    originalName: file.originalname,
    fileName: path.basename(file.filename),
    mimeType: file.mimetype,
    size: file.size,
    tempPath: file.path
  }));
}

function normalizeStoredFileMeta(submissionId, file, fallbackIndex = 0) {
  const fileId = String(file.id || file.fileId || file.fileName || `file-${fallbackIndex}`);
  return {
    id: fileId,
    originalName: file.originalName || file.fileName || `Attachment ${fallbackIndex + 1}`,
    fileName: file.fileName || sanitizeFileName(file.originalName || `attachment-${fallbackIndex + 1}`),
    mimeType: file.mimeType || "application/octet-stream",
    size: Number(file.size || 0),
    blobPath: file.blobPath || "",
    storage: file.storage || "local",
    path: getFileDownloadPath(submissionId, encodeURIComponent(fileId))
  };
}

function mapSubmissionRecord(record) {
  const uploadedFiles = Array.isArray(record.uploadedFiles)
    ? record.uploadedFiles.map((file, index) => normalizeStoredFileMeta(record.id, file, index))
    : [];

  return {
    id: record.id,
    fullName: record.fullName,
    phone: record.phone,
    email: record.email,
    propertyAddress: record.propertyAddress,
    insuranceCompanyName: record.insuranceCompanyName,
    claimNumber: record.claimNumber,
    policyNumber: record.policyNumber,
    damageDescription: record.damageDescription,
    uploadedFiles,
    status: record.status,
    internalNotes: record.internalNotes || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapRowToSubmission(row) {
  let uploadedFiles = [];
  try {
    uploadedFiles = JSON.parse(row.uploaded_files || "[]");
  } catch {
    uploadedFiles = [];
  }

  return mapSubmissionRecord({
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    propertyAddress: row.property_address,
    insuranceCompanyName: row.insurance_company_name,
    claimNumber: row.claim_number,
    policyNumber: row.policy_number,
    damageDescription: row.damage_description,
    uploadedFiles,
    status: row.status,
    internalNotes: row.internal_notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function authenticateInsuranceApiKey(headerValue, requestIp = "unknown") {
  const expectedApiKey = getInsuranceApiKey();
  const token = parseBearerToken(headerValue);

  if (!expectedApiKey || expectedApiKey === "replace_me") {
    console.warn("[insurance-intake] API key is not configured.");
    return { ok: false, statusCode: 500, message: "Insurance intake API key is not configured." };
  }

  if (!token) {
    console.warn(`[insurance-intake] Missing API key from ${requestIp}`);
    return { ok: false, statusCode: 401, message: "Missing API key." };
  }

  if (token !== expectedApiKey) {
    console.warn(`[insurance-intake] Invalid API key from ${requestIp}`);
    return { ok: false, statusCode: 401, message: "Invalid API key." };
  }

  return { ok: true };
}

async function getBlobSdk() {
  if (!hasBlobStorage()) {
    throw new Error("Vercel Blob storage is not configured.");
  }
  if (!blobSdkPromise) {
    blobSdkPromise = import("@vercel/blob");
  }
  return blobSdkPromise;
}

function getBlobSubmissionPath(submissionId) {
  return `${blobSubmissionPrefix}/${submissionId}.json`;
}

async function streamToBuffer(stream) {
  const response = new Response(stream);
  return Buffer.from(await response.arrayBuffer());
}

async function readBlobJson(pathname) {
  const { get } = await getBlobSdk();
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const buffer = await streamToBuffer(result.stream);
  return JSON.parse(buffer.toString("utf8"));
}

async function persistSubmissionRecord(record) {
  const { put } = await getBlobSdk();
  await put(getBlobSubmissionPath(record.id), JSON.stringify(record, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  });
}

async function persistUploadedFilesToBlob(submissionId, uploadedFiles) {
  const { put } = await getBlobSdk();
  const storedFiles = [];

  for (const [index, file] of uploadedFiles.entries()) {
    const fileId = crypto.randomUUID();
    const safeName = sanitizeFileName(file.originalName || file.fileName || `attachment-${index + 1}`);
    const blobPath = `${blobFilePrefix}/${submissionId}/${fileId}-${safeName}`;
    const fileBuffer = fs.readFileSync(file.tempPath);
    const uploadResult = await put(blobPath, fileBuffer, {
      access: "private",
      addRandomSuffix: false,
      contentType: file.mimeType || "application/octet-stream"
    });

    storedFiles.push({
      id: fileId,
      originalName: file.originalName || safeName,
      fileName: file.fileName || safeName,
      mimeType: file.mimeType || "application/octet-stream",
      size: Number(file.size || fileBuffer.length || 0),
      blobPath: uploadResult.pathname,
      storage: "blob"
    });
  }

  return storedFiles;
}

function cleanupTempFiles(uploadedFiles) {
  for (const file of uploadedFiles) {
    if (file?.tempPath && fs.existsSync(file.tempPath)) {
      fs.rmSync(file.tempPath, { force: true });
    }
  }
}

async function createInsuranceSubmission(payload, uploadedFiles = []) {
  const validation = validateSubmissionPayload(payload || {});
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.statusCode = 400;
    throw error;
  }

  const submissionId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (hasBlobStorage()) {
    const storedFiles = await persistUploadedFilesToBlob(submissionId, uploadedFiles);
    const record = {
      id: submissionId,
      fullName: validation.normalized.fullName,
      phone: validation.normalized.phone,
      email: validation.normalized.email,
      propertyAddress: validation.normalized.propertyAddress,
      insuranceCompanyName: validation.normalized.insuranceCompanyName,
      claimNumber: validation.normalized.claimNumber,
      policyNumber: validation.normalized.policyNumber,
      damageDescription: validation.normalized.damageDescription,
      uploadedFiles: storedFiles,
      status: "new",
      internalNotes: "",
      createdAt: now,
      updatedAt: now
    };
    await persistSubmissionRecord(record);
    return mapSubmissionRecord(record);
  }

  const storedFiles = uploadedFiles.map((file, index) => ({
    id: crypto.randomUUID(),
    originalName: file.originalName || file.fileName || `attachment-${index + 1}`,
    fileName: file.fileName || sanitizeFileName(file.originalName || `attachment-${index + 1}`),
    mimeType: file.mimeType || "application/octet-stream",
    size: Number(file.size || 0),
    storage: "local"
  }));

  getDatabase()
    .prepare(`
      INSERT INTO insurance_submissions (
        id,
        full_name,
        phone,
        email,
        property_address,
        insurance_company_name,
        claim_number,
        policy_number,
        damage_description,
        uploaded_files,
        status,
        internal_notes,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?)
    `)
    .run(
      submissionId,
      validation.normalized.fullName,
      validation.normalized.phone,
      validation.normalized.email,
      validation.normalized.propertyAddress,
      validation.normalized.insuranceCompanyName,
      validation.normalized.claimNumber,
      validation.normalized.policyNumber,
      validation.normalized.damageDescription,
      JSON.stringify(storedFiles),
      now,
      now
    );

  return findInsuranceSubmissionById(submissionId);
}

function filterInsuranceSubmissions(submissions, filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  const status = String(filters.status || "").trim();

  return submissions
    .filter((submission) => (status && status !== "all" ? submission.status === status : true))
    .filter((submission) => {
      if (!search) return true;
      const haystack = `${submission.fullName} ${submission.phone} ${submission.email} ${submission.claimNumber} ${submission.propertyAddress}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

async function listInsuranceSubmissions(filters = {}) {
  if (hasBlobStorage()) {
    const { list } = await getBlobSdk();
    const submissions = [];
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const page = await list({ prefix: `${blobSubmissionPrefix}/`, cursor });
      for (const blob of page.blobs || []) {
        const record = await readBlobJson(blob.pathname);
        if (record) submissions.push(mapSubmissionRecord(record));
      }
      hasMore = page.hasMore === true;
      cursor = page.cursor;
    }

    return filterInsuranceSubmissions(submissions, filters);
  }

  const rows = getDatabase()
    .prepare("SELECT * FROM insurance_submissions ORDER BY datetime(created_at) DESC")
    .all();

  return filterInsuranceSubmissions(rows.map(mapRowToSubmission), filters);
}

async function findInsuranceSubmissionById(id) {
  if (hasBlobStorage()) {
    const record = await readBlobJson(getBlobSubmissionPath(id));
    return record ? mapSubmissionRecord(record) : null;
  }

  const row = getDatabase()
    .prepare("SELECT * FROM insurance_submissions WHERE id = ?")
    .get(id);
  return row ? mapRowToSubmission(row) : null;
}

async function updateInsuranceSubmissionStatus(id, nextStatus) {
  if (!allowedStatuses.includes(nextStatus)) {
    const error = new Error(`Status must be one of: ${allowedStatuses.join(", ")}.`);
    error.statusCode = 400;
    throw error;
  }

  if (hasBlobStorage()) {
    const record = await readBlobJson(getBlobSubmissionPath(id));
    if (!record) return null;
    record.status = nextStatus;
    record.updatedAt = new Date().toISOString();
    await persistSubmissionRecord(record);
    return mapSubmissionRecord(record);
  }

  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare("UPDATE insurance_submissions SET status = ?, updated_at = ? WHERE id = ?")
    .run(nextStatus, now, id);

  if (!result.changes) return null;
  return findInsuranceSubmissionById(id);
}

async function updateInsuranceSubmissionNotes(id, notes) {
  if (hasBlobStorage()) {
    const record = await readBlobJson(getBlobSubmissionPath(id));
    if (!record) return null;
    record.internalNotes = String(notes || "").trim();
    record.updatedAt = new Date().toISOString();
    await persistSubmissionRecord(record);
    return mapSubmissionRecord(record);
  }

  const now = new Date().toISOString();
  const result = getDatabase()
    .prepare("UPDATE insurance_submissions SET internal_notes = ?, updated_at = ? WHERE id = ?")
    .run(String(notes || "").trim(), now, id);

  if (!result.changes) return null;
  return findInsuranceSubmissionById(id);
}

async function streamInsuranceSubmissionFile(response, submission, fileId) {
  const normalizedFileId = decodeURIComponent(String(fileId || ""));
  const file = (submission.uploadedFiles || []).find(
    (entry) => String(entry.id) === normalizedFileId || String(entry.fileName) === normalizedFileId
  );

  if (!file) return false;

  if (file.storage === "blob" && file.blobPath) {
    const { get } = await getBlobSdk();
    const result = await get(file.blobPath, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return false;

    response.setHeader("Content-Type", file.mimeType || result.blob.contentType || "application/octet-stream");
    response.setHeader("Content-Disposition", `inline; filename="${sanitizeFileName(file.originalName || file.fileName)}"`);
    const buffer = await streamToBuffer(result.stream);
    response.send(buffer);
    return true;
  }

  const localPath = path.join(insuranceUploadsRoot, path.basename(file.fileName || ""));
  if (!fs.existsSync(localPath)) return false;
  response.sendFile(localPath);
  return true;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      ensureStorageDirectories();
      callback(null, insuranceUploadsRoot);
    },
    filename: (_request, file, callback) => {
      const uniquePrefix = `${Date.now()}-${crypto.randomUUID()}`;
      callback(null, `${uniquePrefix}-${sanitizeFileName(file.originalname)}`);
    }
  }),
  limits: {
    files: 10,
    fileSize: 15 * 1024 * 1024
  }
});

const intakeJsonParser = express.json({ limit: "5mb" });
const intakeUrlencodedParser = express.urlencoded({ extended: true });
const appJsonParser = express.json({ limit: "5mb" });
const appUrlencodedParser = express.urlencoded({ extended: true });

function isMultipartInsuranceIntakeRequest(request) {
  return request.path === "/api/insurance-intake"
    && String(request.get("content-type") || "").toLowerCase().includes("multipart/form-data");
}

function parseInsuranceIntakeRequest(request, response, next) {
  const contentType = String(request.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    return upload.array("files", 10)(request, response, next);
  }
  if (contentType.includes("application/json")) {
    return intakeJsonParser(request, response, next);
  }
  return intakeUrlencodedParser(request, response, next);
}

function insuranceCors() {
  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin === getAllowedWebsiteOrigin()) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS."));
    },
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Authorization"],
    maxAge: 86400
  });
}

function requireInsuranceApiKey(request, response, next) {
  const authResult = authenticateInsuranceApiKey(request.get("authorization"), request.ip);
  if (!authResult.ok) return jsonError(response, authResult.statusCode, authResult.message);
  return next();
}

function requireAdminSession(request, response, next) {
  const sessionResult = readAdminSession(request);
  if (!sessionResult.ok) return jsonError(response, sessionResult.statusCode, sessionResult.message);
  request.adminSession = sessionResult.session;
  return next();
}

async function proxyLegacyInsuranceIntake(request, response) {
  const targetUrl = getLegacyInsuranceProxyTargetUrl();
  if (!targetUrl) {
    return jsonError(response, 500, "Legacy insurance proxy is not configured.");
  }

  try {
    return await proxyLegacyRequest(request, response, targetUrl, { normalizeJsonBody: true });
  } catch (error) {
    console.error("[insurance-intake] Failed to proxy legacy intake request.", error);
    return jsonError(response, 502, "Unable to reach the insurance intake service right now.");
  }
}

async function readRequestBodyBuffer(request) {
  if (Buffer.isBuffer(request.body)) return request.body;

  const contentType = String(request.get("content-type") || "").toLowerCase();
  if (request.body && typeof request.body === "object" && contentType.includes("application/json")) {
    return Buffer.from(JSON.stringify(request.body));
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on("error", reject);
  });
}

async function buildLegacyIntakeProxyBody(request) {
  const contentType = String(request.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data") && request.body && typeof request.body === "object") {
    const formData = new FormData();
    const normalizedFields = normalizeInsurancePayloadAliases(request.body || {});

    Object.entries(normalizedFields).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, String(value));
    });

    (Array.isArray(request.files) ? request.files : []).forEach((file) => {
      const fileBuffer = fs.readFileSync(file.path);
      formData.append(
        "files",
        new Blob([fileBuffer], { type: file.mimetype || "application/octet-stream" }),
        file.originalname || path.basename(file.path)
      );
    });

    return formData;
  }

  return readRequestBodyBuffer(request);
}

function cleanupLegacyProxyFiles(request) {
  if (!Array.isArray(request.files)) return;
  request.files.forEach((file) => {
    if (!file?.path) return;
    try {
      fs.unlinkSync(file.path);
    } catch (_error) {
      // best-effort cleanup for temporary proxy uploads
    }
  });
}

async function proxyLegacyRequest(request, response, targetUrl, options = {}) {
  const { normalizeJsonBody = false, normalizeMultipartBody = false } = options;
  const forwardedHeaders = {};
  const authorization = request.get("authorization");
  const contentType = request.get("content-type");
  const cookie = request.get("cookie");

  if (authorization) forwardedHeaders.authorization = authorization;
  if (contentType) forwardedHeaders["content-type"] = contentType;
  if (cookie) forwardedHeaders.cookie = cookie;

  let bodyBuffer;
  if (!["GET", "HEAD"].includes(String(request.method || "").toUpperCase())) {
    bodyBuffer = normalizeMultipartBody
      ? await buildLegacyIntakeProxyBody(request)
      : await readRequestBodyBuffer(request);

    if (normalizeJsonBody && bodyBuffer && contentType && contentType.includes("application/json")) {
      try {
        bodyBuffer = Buffer.from(JSON.stringify(normalizeInsurancePayloadAliases(JSON.parse(bodyBuffer.toString("utf8")))));
      } catch (error) {
        console.warn("[insurance-intake] Failed to normalize legacy JSON payload before proxying.", error);
      }
    }
  }

  if (bodyBuffer instanceof FormData) {
    delete forwardedHeaders["content-type"];
  }

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers: forwardedHeaders,
    body: bodyBuffer
  });

  response.status(upstreamResponse.status);

  const contentTypeHeader = upstreamResponse.headers.get("content-type");
  const contentDisposition = upstreamResponse.headers.get("content-disposition");
  const location = upstreamResponse.headers.get("location");
  const setCookieHeaders = typeof upstreamResponse.headers.getSetCookie === "function"
    ? upstreamResponse.headers.getSetCookie()
    : [];

  if (contentTypeHeader) response.setHeader("Content-Type", contentTypeHeader);
  if (contentDisposition) response.setHeader("Content-Disposition", contentDisposition);
  if (location) response.setHeader("Location", location);
  setCookieHeaders.forEach((value) => response.append("Set-Cookie", value));

  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  cleanupLegacyProxyFiles(request);
  return response.send(responseBuffer);
}

function createApp() {
  ensureStorageDirectories();
  getDatabase();

  const app = express();
  const firebaseRbac = createFirebaseRbacRouter({
    express,
    parseCookies,
    jsonError,
    getFirebaseAuth,
    getFirebasePublicConfig,
    getFirestore,
    isFirebaseConfigured
  });

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    if (isMultipartInsuranceIntakeRequest(request)) return next();
    return appJsonParser(request, response, next);
  });
  app.use((request, response, next) => {
    if (isMultipartInsuranceIntakeRequest(request)) return next();
    return appUrlencodedParser(request, response, next);
  });

  app.get("/api/health", (request, response) => {
    return response.json(getHealthStatus(request));
  });

  app.use("/api/auth/session/login", rateLimit("firebase-session-login", { max: 12, windowMs: 15 * 60 * 1000 }));
  app.use("/api/access/trial-request", rateLimit("trial-access-request", { max: 6, windowMs: 15 * 60 * 1000 }));
  app.use(firebaseRbac.router);

  app.get("/api/insurance-intake/public-config", insuranceCors(), (request, response) => {
    return response.json(getInsurancePublicConfig(request));
  });

  app.options("/api/insurance-intake/public-config", insuranceCors());
  app.options("/api/insurance-intake", insuranceCors());

  app.use("/api/admin", async (request, response, next) => {
    if (!shouldProxyLegacyAdminApi(request)) return next();
    return proxyLegacyRequest(request, response, `${getLegacyProxyBaseUrl()}${request.originalUrl}`);
  });

  app.use("/api/insurance-intake", async (request, response, next) => {
    if (request.method === "POST" || request.method === "OPTIONS") return next();
    if (!shouldProxyLegacyAdminApi(request)) return next();
    return proxyLegacyRequest(request, response, `${getLegacyProxyBaseUrl()}${request.originalUrl}`);
  });

  app.post("/api/insurance-intake", rateLimit("insurance-intake", { max: 20, windowMs: 15 * 60 * 1000 }), parseInsuranceIntakeRequest, async (request, response, next) => {
    if (!shouldProxyLegacyInsuranceIntake(request)) return next();
    return proxyLegacyInsuranceIntake(request, response);
  });

  app.post("/api/insurance-intake", insuranceCors(), requireInsuranceApiKey, async (request, response) => {
    const uploadedFiles = normalizeUploadedFiles(request);

    try {
      const submission = await createInsuranceSubmission(request.body || {}, uploadedFiles);

      console.info(`[insurance-intake] Submission received ${submission.id} for ${submission.fullName} with ${uploadedFiles.length} file(s).`);

      return response.status(201).json({
        success: true,
        message: "Insurance information received successfully.",
        submissionId: submission.id
      });
    } catch (error) {
      if (error.statusCode) return jsonError(response, error.statusCode, error.message);
      console.error("[insurance-intake] Failed to save submission.", error);
      return jsonError(response, 500, "Unable to save the insurance submission right now.");
    } finally {
      if (hasBlobStorage()) cleanupTempFiles(uploadedFiles);
    }
  });

  app.post("/api/admin/login", rateLimit("admin-login", { max: 5, windowMs: 15 * 60 * 1000 }), (request, response) => {
    const authResult = authenticateAdminCredentials(request.body?.email, request.body?.password);
    if (!authResult.ok) return jsonError(response, authResult.statusCode, authResult.message);

    const session = issueAdminSession(response, request, authResult.email);
    return response.json({
      success: true,
      message: "Admin login successful.",
      session
    });
  });

  app.post("/api/admin/logout", requireAdminSession, (request, response) => {
    clearAdminSessionCookie(response, request);
    return response.json({
      success: true,
      message: "Admin logout successful."
    });
  });

  app.get("/api/admin/session", requireAdminSession, (request, response) => {
    return response.json({
      success: true,
      session: request.adminSession
    });
  });

  app.get("/api/insurance-intake", requireAdminSession, async (request, response) => {
    try {
      const submissions = await listInsuranceSubmissions(request.query || {});
      return response.json({
        success: true,
        submissions
      });
    } catch (error) {
      console.error("[insurance-intake] Failed to list submissions.", error);
      return jsonError(response, 500, "Unable to load insurance submissions right now.");
    }
  });

  app.get("/api/insurance-intake/:id", requireAdminSession, async (request, response) => {
    try {
      const submission = await findInsuranceSubmissionById(request.params.id);
      if (!submission) return jsonError(response, 404, "Insurance submission not found.");

      return response.json({
        success: true,
        submission
      });
    } catch (error) {
      console.error("[insurance-intake] Failed to load submission.", error);
      return jsonError(response, 500, "Unable to load the insurance submission right now.");
    }
  });

  app.get("/api/insurance-intake/:id/files/:fileId", requireAdminSession, async (request, response) => {
    try {
      const submission = await findInsuranceSubmissionById(request.params.id);
      if (!submission) return jsonError(response, 404, "Insurance submission not found.");

      const streamed = await streamInsuranceSubmissionFile(response, submission, request.params.fileId);
      if (!streamed) return jsonError(response, 404, "Insurance file not found.");
      return undefined;
    } catch (error) {
      console.error("[insurance-intake] Failed to stream uploaded file.", error);
      return jsonError(response, 500, "Unable to open the uploaded file right now.");
    }
  });

  app.patch("/api/insurance-intake/:id/status", requireAdminSession, async (request, response) => {
    try {
      const submission = await updateInsuranceSubmissionStatus(request.params.id, String(request.body?.status || "").trim());
      if (!submission) return jsonError(response, 404, "Insurance submission not found.");

      return response.json({
        success: true,
        message: "Insurance submission status updated successfully.",
        submission
      });
    } catch (error) {
      if (error.statusCode) return jsonError(response, error.statusCode, error.message);
      console.error("[insurance-intake] Failed to update status.", error);
      return jsonError(response, 500, "Unable to update the insurance submission status right now.");
    }
  });

  app.patch("/api/insurance-intake/:id/notes", requireAdminSession, async (request, response) => {
    try {
      const submission = await updateInsuranceSubmissionNotes(request.params.id, request.body?.notes || "");
      if (!submission) return jsonError(response, 404, "Insurance submission not found.");

      return response.json({
        success: true,
        message: "Insurance submission notes updated successfully.",
        submission
      });
    } catch (error) {
      console.error("[insurance-intake] Failed to update notes.", error);
      return jsonError(response, 500, "Unable to update the insurance submission notes right now.");
    }
  });

  app.post("/api/payments/stripe/intent", (request, response) => {
    return response.status(202).json({
      success: true,
      rail: "Card",
      status: "configuration_required",
      message: "Stripe payment intent route is online. Add live Stripe credentials before collecting card payments.",
      requestedAmount: Number(request.body?.amount || 0),
      customer: String(request.body?.customer || "")
    });
  });

  app.post("/api/payments/paypal/order", (request, response) => {
    return response.status(202).json({
      success: true,
      rail: "PayPal",
      status: "configuration_required",
      message: "PayPal order route is online. Add live PayPal credentials before collecting PayPal payments.",
      requestedAmount: Number(request.body?.amount || 0),
      customer: String(request.body?.customer || "")
    });
  });

  app.get("/api/payments/zelle/instructions", (_request, response) => {
    return response.status(202).json({
      success: true,
      rail: "Zelle",
      status: "configuration_required",
      message: "Zelle instructions route is online. Configure the approved business Zelle email or phone before sending customer instructions."
    });
  });

  app.get("/api/payments/wire/instructions", (_request, response) => {
    return response.status(202).json({
      success: true,
      rail: "Wire",
      status: "configuration_required",
      message: "Wire instructions route is online. Configure verified business banking instructions before sending payment details."
    });
  });

  app.get("/api/integrations/quickbooks/oauth/start", (_request, response) => {
    return response.status(202).json({
      success: true,
      integration: "QuickBooks",
      status: "configuration_required",
      message: "QuickBooks OAuth route is online. Add Intuit OAuth credentials before starting a live QuickBooks connection."
    });
  });

  app.use(express.static(rootDir, { extensions: ["html"] }));
  app.use("/uploads", express.static(uploadsRoot));

  app.get(/^(?!\/api\/).*/, (_request, response) => {
    return response.sendFile(path.join(rootDir, "index.html"));
  });

  app.use((error, request, response, next) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") return jsonError(response, 400, "Each uploaded file must be 15 MB or smaller.");
      if (error.code === "LIMIT_FILE_COUNT") return jsonError(response, 400, "You can upload up to 10 files per submission.");
    }
    if (error.message === "Origin not allowed by CORS.") {
      return jsonError(response, 403, "This website origin is not allowed to call the insurance intake API.");
    }
    console.error("[server] Unhandled error.", error);
    return jsonError(response, 500, "Unexpected server error.");
  });

  return app;
}

module.exports = {
  adminSessionCookieName,
  allowedStatuses,
  authenticateInsuranceApiKey,
  authenticateAdminCredentials,
  buildLegacyIntakeProxyBody,
  createAdminSessionToken,
  createInsuranceSubmission,
  createApp,
  ensureStorageDirectories,
  findInsuranceSubmissionById,
  getDatabase,
  getHealthStatus,
  getInsurancePublicConfig,
  getRequestHost,
  getStorageBackend,
  insuranceUploadsRoot,
  listInsuranceSubmissions,
  normalizeInsurancePayloadAliases,
  proxyLegacyRequest,
  readAdminSession,
  requireAdminSession,
  shouldProxyLegacyAdminApi,
  shouldProxyLegacyInsuranceIntake,
  updateInsuranceSubmissionNotes,
  updateInsuranceSubmissionStatus,
  validateSubmissionPayload
};
