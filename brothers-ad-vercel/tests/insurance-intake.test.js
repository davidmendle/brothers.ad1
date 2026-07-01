import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.INSURANCE_API_KEY = "test-secret";
process.env.ALLOWED_WEBSITE_ORIGIN = "https://YOUR-MAIN-WEBSITE-DOMAIN.com";
process.env.ADMIN_EMAILS = "owner@brothersos.test,operator@brothersos.test";
process.env.ADMIN_PASSWORD = "correct horse battery staple";
process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret-with-enough-length";
process.env.ADMIN_COOKIE_SECURE = "false";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brothers-insurance-test-"));
process.env.DATABASE_URL = `file:${path.join(tempRoot, "test.db")}`;
const baselineEnv = {
  INSURANCE_API_KEY: "test-secret",
  ALLOWED_WEBSITE_ORIGIN: "https://YOUR-MAIN-WEBSITE-DOMAIN.com",
  ADMIN_EMAILS: "owner@brothersos.test,operator@brothersos.test",
  ADMIN_PASSWORD: "correct horse battery staple",
  ADMIN_JWT_SECRET: "test-admin-jwt-secret-with-enough-length",
  ADMIN_COOKIE_SECURE: "false",
  DATABASE_URL: process.env.DATABASE_URL
};

const require = createRequire(import.meta.url);
const express = require("express");
const {
  adminSessionCookieName,
  authenticateInsuranceApiKey,
  authenticateAdminCredentials,
  buildLegacyIntakeProxyBody,
  createAdminSessionToken,
  createApp,
  createInsuranceSubmission,
  getDatabase,
  getHealthStatus,
  getInsurancePublicConfig,
  listInsuranceSubmissions,
  normalizeInsurancePayloadAliases,
  shouldProxyLegacyAdminApi,
  readAdminSession,
  requireAdminSession,
  shouldProxyLegacyInsuranceIntake,
  updateInsuranceSubmissionNotes,
  updateInsuranceSubmissionStatus
} = require("../createApp");
const { createFirebaseRbacRouter } = require("../lib/firebase-rbac-routes");

const primaryAdminEmail = process.env.ADMIN_EMAILS.split(",")[0];
const secondaryAdminEmail = process.env.ADMIN_EMAILS.split(",")[1];
const originalFetch = global.fetch;

const db = getDatabase();

const validPayload = {
  fullName: "Jane Carrier",
  phone: "555-111-2222",
  email: "jane@example.com",
  propertyAddress: "123 Main Street",
  insuranceCompanyName: "Harbor Mutual",
  claimNumber: "CLM-1001",
  policyNumber: "PLC-2002",
  damageDescription: "Water damage in kitchen and hallway."
};

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hashPortalCode(value) {
  return hashSecret(
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "")
  );
}

function createFakeFirestore(seed = {}) {
  const store = new Map(
    Object.entries(seed).map(([collectionName, docs]) => [
      collectionName,
      new Map(Object.entries(docs))
    ])
  );
  const ensureCollection = (collectionName) => {
    if (!store.has(collectionName)) store.set(collectionName, new Map());
    return store.get(collectionName);
  };
  const snap = (id, data) => ({
    id,
    exists: Boolean(data),
    data: () => data
  });
  const querySnap = (docs) => ({
    docs,
    empty: docs.length === 0
  });
  const docsFromCollection = (collectionMap) => Array.from(collectionMap.entries()).map(([id, data]) => snap(id, data));
  const makeDocRef = (collectionName, id) => {
    const collectionMap = ensureCollection(collectionName);
    return {
      id,
      get: async () => snap(id, collectionMap.get(id)),
      set: async (data, options = {}) => {
        const current = collectionMap.get(id) || {};
        collectionMap.set(id, options.merge ? { ...current, ...data } : data);
      },
      delete: async () => {
        collectionMap.delete(id);
      }
    };
  };
  const makeQuery = (docs) => ({
    limit(count) {
      return makeQuery(docs.slice(0, count));
    },
    orderBy() {
      return makeQuery(docs);
    },
    get: async () => querySnap(docs)
  });
  return {
    collection(collectionName) {
      const collectionMap = ensureCollection(collectionName);
      return {
        doc(id) {
          return makeDocRef(collectionName, id);
        },
        add: async (data) => {
          const id = `doc-${collectionMap.size + 1}`;
          collectionMap.set(id, data);
          return { id };
        },
        get: async () => querySnap(docsFromCollection(collectionMap)),
        limit(count) {
          return makeQuery(docsFromCollection(collectionMap).slice(0, count));
        },
        orderBy() {
          return makeQuery(docsFromCollection(collectionMap));
        },
        where(field, _operator, value) {
          return makeQuery(docsFromCollection(collectionMap).filter((doc) => doc.data()?.[field] === value));
        }
      };
    },
    batch() {
      const operations = [];
      return {
        set(ref, data, options) {
          operations.push(() => ref.set(data, options));
        },
        commit: async () => {
          for (const operation of operations) await operation();
        }
      };
    },
    dump(collectionName) {
      return Object.fromEntries(ensureCollection(collectionName).entries());
    }
  };
}

beforeEach(() => {
  db.exec("DELETE FROM insurance_submissions");
  global.fetch = originalFetch;
  Object.entries(baselineEnv).forEach(([key, value]) => {
    process.env[key] = value;
  });
  [
    "OS_BASE_URL",
    "LEGACY_INSURANCE_PROXY_HOSTS",
    "LEGACY_INSURANCE_PROXY_TARGET_URL",
    "ENABLE_LEGACY_PROXY",
    "ENABLE_LEGACY_ADMIN_PROXY",
    "VERCEL",
    "ADMIN_EMAIL",
    "BLOB_READ_WRITE_TOKEN",
    "FIREBASE_ALLOWED_LOGIN_EMAILS",
    "FIREBASE_OWNER_ONLY_LOGIN",
    "SUPER_ADMIN_EMAILS"
  ].forEach((key) => {
    delete process.env[key];
  });
});

afterAll(() => {
  db.close();
});

describe("insurance intake logic", () => {
  it("accepts a valid submission", async () => {
    const submission = await createInsuranceSubmission(validPayload);

    expect(submission.fullName).toBe(validPayload.fullName);
    expect(submission.status).toBe("new");

    const saved = db.prepare("SELECT * FROM insurance_submissions WHERE id = ?").get(submission.id);
    expect(saved.full_name).toBe(validPayload.fullName);
  });

  it("rejects a missing API key", () => {
    const result = authenticateInsuranceApiKey("", "127.0.0.1");

    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      message: "Missing API key."
    });
  });

  it("rejects a wrong API key", () => {
    const result = authenticateInsuranceApiKey("Bearer wrong-key", "127.0.0.1");

    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      message: "Invalid API key."
    });
  });

  it("rejects submissions with missing required fields", async () => {
    await expect(
      createInsuranceSubmission({
        fullName: "Jane Carrier",
        email: "jane@example.com"
      })
    ).rejects.toThrow(/Missing required fields/);
  });

  it("accepts website-form field aliases for insurance company and description", async () => {
    const submission = await createInsuranceSubmission({
      ...validPayload,
      insuranceCompanyName: "",
      damageDescription: "",
      insuranceCompany: validPayload.insuranceCompanyName,
      description: validPayload.damageDescription
    });

    expect(submission.insuranceCompanyName).toBe(validPayload.insuranceCompanyName);
    expect(submission.damageDescription).toBe(validPayload.damageDescription);
  });

  it("normalizes website-form field aliases before proxying upstream", () => {
    expect(
      normalizeInsurancePayloadAliases({
        fullName: "John",
        insuranceCompany: "State Farm",
        description: "John is this"
      })
    ).toEqual({
      fullName: "John",
      insuranceCompany: "State Farm",
      description: "John is this",
      insuranceCompanyName: "State Farm",
      damageDescription: "John is this"
    });
  });

  it("stores uploaded file metadata with the submission", async () => {
    const uploadedFiles = [
      {
        originalName: "damage-photo.jpg",
        fileName: "123-damage-photo.jpg",
        mimeType: "image/jpeg",
        size: 2048
      }
    ];

    const submission = await createInsuranceSubmission(validPayload, uploadedFiles);
    const listed = await listInsuranceSubmissions({ search: "Jane Carrier" });

    expect(listed).toHaveLength(1);
    expect(listed[0].uploadedFiles).toHaveLength(1);
    expect(listed[0].uploadedFiles[0].path).toContain(`/api/insurance-intake/${submission.id}/files/`);

    const updatedStatus = await updateInsuranceSubmissionStatus(submission.id, "reviewed");
    const updatedNotes = await updateInsuranceSubmissionNotes(submission.id, "Called insured and assigned estimator.");

    expect(updatedStatus.status).toBe("reviewed");
    expect(updatedNotes.internalNotes).toContain("assigned estimator");
  });

  it("rejects invalid admin credentials", () => {
    const result = authenticateAdminCredentials(primaryAdminEmail, "wrong-password");

    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      message: "Invalid admin credentials."
    });
  });

  it("accepts a secondary configured admin email", () => {
    const result = authenticateAdminCredentials(secondaryAdminEmail, process.env.ADMIN_PASSWORD);

    expect(result.ok).toBe(true);
    expect(result.email).toBe(secondaryAdminEmail);
  });

  it("reads a valid admin session from the signed cookie", () => {
    const now = Date.now();
    const token = createAdminSessionToken(
      {
        sub: primaryAdminEmail,
        role: "admin",
        iss: "brothers-os",
        iat: now,
        exp: now + 60_000
      },
      process.env.ADMIN_JWT_SECRET
    );

    const request = {
      get(headerName) {
        if (headerName === "cookie") {
          return `${adminSessionCookieName}=${token}`;
        }
        return "";
      }
    };

    const result = readAdminSession(request);
    expect(result.ok).toBe(true);
    expect(result.session.email).toBe(primaryAdminEmail);
    expect(result.session.role).toBe("admin");
  });

  it("blocks middleware access when the admin session cookie is missing", () => {
    const request = {
      get() {
        return "";
      }
    };
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };
    let nextCalled = false;

    requireAdminSession(request, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: "Authentication required."
    });
  });

  it("allows middleware access when the admin session cookie is valid", () => {
    const now = Date.now();
    const token = createAdminSessionToken(
      {
        sub: primaryAdminEmail,
        role: "admin",
        iss: "brothers-os",
        iat: now,
        exp: now + 60_000
      },
      process.env.ADMIN_JWT_SECRET
    );
    const request = {
      get(headerName) {
        if (headerName === "cookie") {
          return `${adminSessionCookieName}=${token}`;
        }
        return "";
      }
    };
    const response = {
      status() {
        return this;
      },
      json() {
        return this;
      }
    };
    let nextCalled = false;

    requireAdminSession(request, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(request.adminSession.email).toBe(primaryAdminEmail);
  });

  it("exposes a public insurance config endpoint for the website", async () => {
    const payload = getInsurancePublicConfig({
      protocol: "http",
      get(headerName) {
        return headerName === "host" ? "127.0.0.1" : "";
      }
    });

    expect(payload).toEqual({
      success: true,
      config: {
        intakeEnabled: true,
        uploadUrl: "http://127.0.0.1/api/insurance-intake",
        adminLoginUrl: "http://127.0.0.1/#module/insurance",
        maxFiles: 10,
        maxFileSizeBytes: 15 * 1024 * 1024,
        allowedOrigin: process.env.ALLOWED_WEBSITE_ORIGIN
      }
    });
  });

  it("exposes backend readiness for OS connection", () => {
    const payload = getHealthStatus({
      protocol: "http",
      get(headerName) {
        return headerName === "host" ? "127.0.0.1" : "";
      }
    });

    expect(payload).toEqual({
      success: true,
      service: "brothers-os",
      firebaseAuth: {
        configured: true,
        adminConfigured: false,
        webConfigured: true,
        projectId: "brothers-restoration-website",
        missingAdminEnv: [
          "FIREBASE_CLIENT_EMAIL",
          "FIREBASE_PRIVATE_KEY"
        ],
        missingWebEnv: []
      },
      insuranceIntake: {
        intakeEnabled: true,
        apiKeyConfigured: true,
        adminConfigured: true,
        adminEmailsConfigured: 2,
        allowedOrigin: process.env.ALLOWED_WEBSITE_ORIGIN,
        allowedOriginConfigured: false,
        osBaseUrlConfigured: false,
        osBaseUrl: "http://127.0.0.1",
        uploadUrl: "http://127.0.0.1/api/insurance-intake",
        storageBackend: "sqlite-file",
        storageDurable: false,
        legacyProxyMode: false,
        warnings: [
          "ALLOWED_WEBSITE_ORIGIN is still using the placeholder domain.",
          "Insurance submissions are using sqlite-file storage. Configure BLOB_READ_WRITE_TOKEN for durable production storage on Vercel.",
          "Firebase auth/RBAC is not fully configured. Missing admin env: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Missing web env: none."
        ]
      }
    });
  });

  it("rejects non-owner Firebase Google sessions when server-side access storage is not configured", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org";

    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies: () => ({}),
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifyIdToken: async () => ({
            uid: "non-owner-uid",
            email: "contractor@brothersrestoration.org",
            email_verified: true,
            firebase: { sign_in_provider: "google.com" }
          })
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: false,
        webConfigured: true
      }),
      getFirestore() {
        return null;
      },
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-google-token" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: "Only david@brothersrestoration.org is approved to sign in to Brothers OS."
    });
  });

  it("allows an issued contractor grant even when owner-only Super Admin login is enabled", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org";
    process.env.SUPER_ADMIN_EMAILS = "david@brothersrestoration.org";
    const accessToken = "issued-contractor-link-token";
    const accessCode = "CON-ABC123";
    const fakeDb = createFakeFirestore({
      osAccessGrants: {
        grant1: {
          email: "contractor@brothersrestoration.org",
          displayName: "Issued Contractor",
          roleId: "contractor",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          contractorId: "contractor-demo",
          accessScope: "48_hour_access",
          status: "issued",
          tokenHash: hashSecret(accessToken),
          portalCodeHash: hashSecret(accessCode),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies: () => ({}),
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifyIdToken: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            email_verified: true,
            name: "Issued Contractor",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            displayName: "Issued Contractor",
            disabled: false
          }),
          setCustomUserClaims: async () => undefined,
          createSessionCookie: async () => "session-cookie"
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({
        idToken: "verified-google-token",
        accessToken,
        accessCode
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.session).toMatchObject({
      email: "contractor@brothersrestoration.org",
      roleId: "contractor",
      contractorId: "contractor-demo"
    });
    expect(fakeDb.dump("osAccessGrants").grant1.status).toBe("active");
  });

  it("does not open non-owner Google login when owner-only mode is disabled without Admin storage", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "false";

    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies: () => ({}),
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifyIdToken: async () => ({
            uid: "any-google-uid",
            email: "anyone@example.com",
            email_verified: true,
            firebase: { sign_in_provider: "google.com" }
          })
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: false,
        webConfigured: true
      }),
      getFirestore() {
        return null;
      },
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-google-token" });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/Firebase Admin credentials are required/i);
  });

  it("keeps a contractor grant issued when the portal code is wrong", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org";
    process.env.SUPER_ADMIN_EMAILS = "david@brothersrestoration.org";
    const accessToken = "issued-contractor-link-token";
    const accessCode = "CON-ABCD-EFGH-JKLM";
    const fakeDb = createFakeFirestore({
      osAccessGrants: {
        grant1: {
          email: "contractor@brothersrestoration.org",
          displayName: "Issued Contractor",
          roleId: "contractor",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          contractorId: "contractor-demo",
          accessScope: "48_hour_access",
          status: "issued",
          tokenHash: hashSecret(accessToken),
          portalCodeHash: hashPortalCode(accessCode),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies: () => ({}),
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifyIdToken: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            email_verified: true,
            name: "Issued Contractor",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            displayName: "Issued Contractor",
            disabled: false
          }),
          setCustomUserClaims: async () => undefined,
          createSessionCookie: async () => "session-cookie"
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({
        idToken: "verified-google-token",
        accessToken,
        accessCode: "CON-WRONG-CODE-0000"
      });

    expect(response.status).toBe(403);
    expect(fakeDb.dump("osAccessGrants").grant1.status).toBe("issued");
    expect(fakeDb.dump("osAccessGrants").grant1.failedCodeAttempts).toBe(1);
  });

  it("allows a contractor session refresh after a grant has been issued", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org";
    const fakeDb = createFakeFirestore({
      osUsers: {
        "contractor-uid": {
          email: "contractor@brothersrestoration.org",
          displayName: "Issued Contractor",
          roleId: "contractor",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          contractorId: "contractor-demo",
          accessScope: "48_hour_access",
          accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          status: "active",
          disabled: false
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies(headerValue = "") {
        return Object.fromEntries(String(headerValue).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
      },
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifySessionCookie: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            email_verified: true,
            name: "Issued Contractor",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async () => ({
            uid: "contractor-uid",
            email: "contractor@brothersrestoration.org",
            displayName: "Issued Contractor",
            disabled: false
          }),
          setCustomUserClaims: async () => undefined
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=session-cookie"]);

    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({
      email: "contractor@brothersrestoration.org",
      roleId: "contractor",
      contractorId: "contractor-demo"
    });
  });

  it("blocks franchise owners from escalating managed users into higher roles", async () => {
    const fakeDb = createFakeFirestore({
      osUsers: {
        "franchise-owner-uid": {
          email: "franchise@example.com",
          displayName: "Franchise Owner",
          roleId: "franchise_owner",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        },
        "worker-uid": {
          email: "worker@example.com",
          displayName: "Worker",
          roleId: "worker",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies(headerValue = "") {
        return Object.fromEntries(String(headerValue).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
      },
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifySessionCookie: async () => ({
            uid: "franchise-owner-uid",
            email: "franchise@example.com",
            email_verified: true,
            name: "Franchise Owner",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async (uid) => ({
            uid,
            email: uid === "worker-uid" ? "worker@example.com" : "franchise@example.com",
            displayName: uid === "worker-uid" ? "Worker" : "Franchise Owner",
            disabled: false
          }),
          setCustomUserClaims: async () => undefined,
          updateUser: async () => undefined
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .patch("/api/rbac/users/worker-uid")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({ roleId: "business_owner" });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/Changing user roles requires/i);
    expect(fakeDb.dump("osUsers")["worker-uid"].roleId).toBe("worker");
  });

  it("returns created Firebase users in the managed account list", async () => {
    process.env.SUPER_ADMIN_EMAILS = "david@brothersrestoration.org";
    const authUsers = new Map([
      ["owner-uid", {
        uid: "owner-uid",
        email: "david@brothersrestoration.org",
        displayName: "David",
        disabled: false
      }]
    ]);
    const fakeDb = createFakeFirestore({
      osUsers: {
        "owner-uid": {
          email: "david@brothersrestoration.org",
          displayName: "David",
          roleId: "super_admin",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies(headerValue = "") {
        return Object.fromEntries(String(headerValue).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
      },
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifySessionCookie: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            email_verified: true,
            name: "David",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async (uid) => authUsers.get(uid),
          createUser: async (payload) => {
            const user = {
              uid: "created-worker-uid",
              email: payload.email,
              displayName: payload.displayName,
              disabled: Boolean(payload.disabled)
            };
            authUsers.set(user.uid, user);
            return user;
          },
          setCustomUserClaims: async () => undefined,
          listUsers: async () => ({ users: Array.from(authUsers.values()) })
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const createResponse = await request(app)
      .post("/api/rbac/users")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({
        displayName: "Created Worker",
        email: "created.worker@example.com",
        password: "temporary-password-123",
        roleId: "worker",
        companyId: "default-company",
        franchiseIds: ["default-franchise"]
      });
    const listResponse = await request(app)
      .get("/api/rbac/users")
      .set("Cookie", ["brothers_os_session=session-cookie"]);

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.user).toMatchObject({
      uid: "created-worker-uid",
      email: "created.worker@example.com",
      roleId: "worker"
    });
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.users.map((user) => user.email)).toContain("created.worker@example.com");
    expect(fakeDb.dump("osUsers")["created-worker-uid"].roleId).toBe("worker");
  });

  it("filters managed account lists to a franchise owner's assigned scope", async () => {
    const fakeDb = createFakeFirestore({
      osUsers: {
        "franchise-owner-uid": {
          email: "franchise@example.com",
          displayName: "Franchise Owner",
          roleId: "franchise_owner",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        },
        "worker-same-uid": {
          email: "same-worker@example.com",
          displayName: "Same Franchise Worker",
          roleId: "worker",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        },
        "worker-other-uid": {
          email: "other-worker@example.com",
          displayName: "Other Franchise Worker",
          roleId: "worker",
          companyId: "default-company",
          franchiseIds: ["other-franchise"],
          status: "active",
          disabled: false
        },
        "business-owner-uid": {
          email: "business-owner@example.com",
          displayName: "Business Owner",
          roleId: "business_owner",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies(headerValue = "") {
        return Object.fromEntries(String(headerValue).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
      },
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifySessionCookie: async () => ({
            uid: "franchise-owner-uid",
            email: "franchise@example.com",
            email_verified: true,
            name: "Franchise Owner",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async (uid) => ({
            uid,
            email: fakeDb.dump("osUsers")[uid]?.email,
            displayName: fakeDb.dump("osUsers")[uid]?.displayName,
            disabled: false
          }),
          setCustomUserClaims: async () => undefined,
          listUsers: async () => ({
            users: Object.entries(fakeDb.dump("osUsers")).map(([uid, user]) => ({
              uid,
              email: user.email,
              displayName: user.displayName,
              disabled: false
            }))
          })
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .get("/api/rbac/users")
      .set("Cookie", ["brothers_os_session=session-cookie"]);

    expect(response.status).toBe(200);
    expect(response.body.users.map((user) => user.email).sort()).toEqual([
      "franchise@example.com",
      "same-worker@example.com"
    ]);
  });

  it("rejects Super Admin assignment for any email outside the owner allowlist", async () => {
    process.env.SUPER_ADMIN_EMAILS = "david@brothersrestoration.org";
    const fakeDb = createFakeFirestore({
      osUsers: {
        "owner-uid": {
          email: "david@brothersrestoration.org",
          displayName: "David",
          roleId: "super_admin",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          status: "active",
          disabled: false
        }
      }
    });
    const app = express();
    app.use(express.json());
    const { router } = createFirebaseRbacRouter({
      express,
      parseCookies(headerValue = "") {
        return Object.fromEntries(String(headerValue).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2));
      },
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifySessionCookie: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            email_verified: true,
            name: "David",
            firebase: { sign_in_provider: "google.com" }
          }),
          getUser: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            displayName: "David",
            disabled: false
          }),
          createUser: async () => {
            throw new Error("createUser should not be called");
          },
          setCustomUserClaims: async () => undefined
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/rbac/users")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({
        displayName: "Second Admin",
        email: "other-admin@example.com",
        password: "temporary-password-123",
        roleId: "super_admin"
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/Super Admin access is restricted/i);
  });

  it("uses production-safe domain defaults without deriving admin credentials on Vercel", () => {
    delete process.env.ALLOWED_WEBSITE_ORIGIN;
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_JWT_SECRET;
    process.env.VERCEL = "1";

    try {
      const payload = getHealthStatus({
        protocol: "https",
        get(headerName) {
          return headerName === "host" ? "brothers.ad" : "";
        }
      });

      expect(payload.insuranceIntake.adminConfigured).toBe(false);
      expect(payload.insuranceIntake.adminEmailsConfigured).toBe(0);
      expect(payload.insuranceIntake.allowedOrigin).toBe("https://www.brothersrestoration.org");
      expect(payload.insuranceIntake.allowedOriginConfigured).toBe(true);
      expect(payload.insuranceIntake.osBaseUrlConfigured).toBe(true);
      expect(payload.insuranceIntake.osBaseUrl).toBe("https://brothers.ad");
      expect(payload.insuranceIntake.legacyProxyMode).toBe(false);
      expect(payload.insuranceIntake.warnings).not.toContain(
        "ALLOWED_WEBSITE_ORIGIN is still using the placeholder domain."
      );
      expect(payload.insuranceIntake.warnings).toContain(
        "Admin dashboard authentication is not fully configured. Set ADMIN_EMAILS, ADMIN_PASSWORD, and ADMIN_JWT_SECRET."
      );
    } finally {
      process.env.ALLOWED_WEBSITE_ORIGIN = "https://YOUR-MAIN-WEBSITE-DOMAIN.com";
      process.env.ADMIN_EMAILS = "owner@brothersos.test,operator@brothersos.test";
      process.env.ADMIN_PASSWORD = "correct horse battery staple";
      process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret-with-enough-length";
      delete process.env.VERCEL;
    }
  });

  it("surfaces warnings for legacy OS base URLs", () => {
    process.env.OS_BASE_URL = "https://updated-ui-brs-site.vercel.app";
    process.env.LEGACY_INSURANCE_PROXY_HOSTS = "updated-ui-brs-site.vercel.app";
    process.env.LEGACY_INSURANCE_PROXY_TARGET_URL = "https://updated-os-systems-nu.vercel.app/api/insurance-intake";
    process.env.ENABLE_LEGACY_PROXY = "true";
    try {
      const payload = getHealthStatus({
        protocol: "https",
        get(headerName) {
          return headerName === "host" ? "updated-ui-brs-site.vercel.app" : "";
        }
      });

      expect(payload.insuranceIntake.osBaseUrlConfigured).toBe(true);
      expect(payload.insuranceIntake.legacyProxyMode).toBe(true);
      expect(payload.insuranceIntake.uploadUrl).toBe("https://updated-ui-brs-site.vercel.app/api/insurance-intake");
      expect(payload.insuranceIntake.warnings).toContain(
        "OS_BASE_URL points to a legacy intake alias. Update it to the current live OS domain before relying on public-config or health output."
      );
    } finally {
      delete process.env.OS_BASE_URL;
      delete process.env.LEGACY_INSURANCE_PROXY_HOSTS;
      delete process.env.LEGACY_INSURANCE_PROXY_TARGET_URL;
      delete process.env.ENABLE_LEGACY_PROXY;
    }
  });

  it("only proxies when the legacy host and target are explicitly configured", () => {
    process.env.LEGACY_INSURANCE_PROXY_HOSTS = "updated-ui-brs-site.vercel.app";
    process.env.LEGACY_INSURANCE_PROXY_TARGET_URL = "https://updated-os-systems-nu.vercel.app/api/insurance-intake";
    process.env.ENABLE_LEGACY_PROXY = "true";
    try {
      const shouldProxy = shouldProxyLegacyInsuranceIntake({
        get(headerName) {
          return headerName === "host" ? "updated-ui-brs-site.vercel.app" : "";
        }
      });
      const shouldProxyLiveDomain = shouldProxyLegacyInsuranceIntake({
        get(headerName) {
          return headerName === "host" ? "brothers.ad" : "";
        }
      });

      expect(shouldProxy).toBe(true);
      expect(shouldProxyLiveDomain).toBe(false);
    } finally {
      delete process.env.LEGACY_INSURANCE_PROXY_HOSTS;
      delete process.env.LEGACY_INSURANCE_PROXY_TARGET_URL;
      delete process.env.ENABLE_LEGACY_PROXY;
    }
  });

  it("falls back to the legacy intake API on Vercel when the current project is missing its API key", async () => {
    delete process.env.INSURANCE_API_KEY;
    process.env.VERCEL = "1";
    process.env.ENABLE_LEGACY_PROXY = "true";

    const app = createApp();
    let forwardedRequest = null;

    global.fetch = async (url, options) => {
      forwardedRequest = {
        url,
        method: options.method,
        headers: options.headers,
        body: options.body ? JSON.parse(Buffer.from(options.body).toString("utf8")) : null
      };

      return new Response(
        JSON.stringify({
          success: true,
          submissionId: "legacy-fallback-submission"
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    };

    try {
      const response = await request(app)
        .post("/api/insurance-intake")
        .set("host", "updated-ui-brs-site.vercel.app")
        .set("Authorization", "Bearer fallback-test-key")
        .send({
          fullName: "Proxy Fallback",
          phone: "555-123-4567",
          email: "proxy@example.com",
          propertyAddress: "123 Main Street",
          insuranceCompany: "Fallback Mutual",
          claimNumber: "CLM-2001",
          policyNumber: "PLC-3002",
          description: "Proxy fallback still accepts website field aliases."
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        submissionId: "legacy-fallback-submission"
      });
      expect(forwardedRequest).toEqual({
        url: "https://updated-os-systems-nu.vercel.app/api/insurance-intake",
        method: "POST",
        headers: {
          authorization: "Bearer fallback-test-key",
          "content-type": expect.stringContaining("application/json")
        },
        body: {
          fullName: "Proxy Fallback",
          phone: "555-123-4567",
          email: "proxy@example.com",
          propertyAddress: "123 Main Street",
          insuranceCompany: "Fallback Mutual",
          claimNumber: "CLM-2001",
          policyNumber: "PLC-3002",
          description: "Proxy fallback still accepts website field aliases.",
          insuranceCompanyName: "Fallback Mutual",
          damageDescription: "Proxy fallback still accepts website field aliases."
        }
      });
    } finally {
      process.env.INSURANCE_API_KEY = "test-secret";
      delete process.env.VERCEL;
      delete process.env.ENABLE_LEGACY_PROXY;
    }
  });

  it("does not proxy legacy admin sessions unless the admin proxy is explicitly enabled", async () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_JWT_SECRET;
    delete process.env.INSURANCE_API_KEY;
    process.env.VERCEL = "1";
    process.env.ENABLE_LEGACY_PROXY = "true";

    const app = createApp();
    let forwardedUrl = "";

    global.fetch = async (url) => {
      forwardedUrl = url;
      return new Response(
        JSON.stringify({
          success: true,
          session: {
            email: "chaim@brothersrestoration.org",
            role: "admin"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    };

    try {
      const response = await request(app)
        .get("/api/admin/session")
        .set("host", "updated-ui-brs-site.vercel.app");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(forwardedUrl).toBe("");
      expect(
        shouldProxyLegacyAdminApi({
          get(headerName) {
            return headerName === "host" ? "updated-ui-brs-site.vercel.app" : "";
          }
        })
      ).toBe(false);
    } finally {
      process.env.ADMIN_EMAILS = "owner@brothersos.test,operator@brothersos.test";
      process.env.ADMIN_PASSWORD = "correct horse battery staple";
      process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret-with-enough-length";
      process.env.INSURANCE_API_KEY = "test-secret";
      delete process.env.VERCEL;
      delete process.env.ENABLE_LEGACY_PROXY;
    }
  });

  it("normalizes multipart website fields before proxying to the legacy intake API", async () => {
    const body = await buildLegacyIntakeProxyBody({
      body: {
        fullName: "Proxy Multipart",
        phone: "555-123-4567",
        email: "proxy@example.com",
        propertyAddress: "123 Main Street",
        insuranceCompany: "Fallback Mutual",
        claimNumber: "CLM-2005",
        policyNumber: "PLC-3006",
        description: "Multipart fallback still accepts website field aliases."
      },
      files: [],
      get(headerName) {
        return headerName === "content-type" ? "multipart/form-data; boundary=test-boundary" : "";
      }
    });

    expect(body.get("insuranceCompany")).toBe("Fallback Mutual");
    expect(body.get("insuranceCompanyName")).toBe("Fallback Mutual");
    expect(body.get("damageDescription")).toBe("Multipart fallback still accepts website field aliases.");
  });

  it("proxies legacy alias submissions to the live OS deployment", async () => {
    process.env.LEGACY_INSURANCE_PROXY_HOSTS = "updated-ui-brs-site.vercel.app";
    process.env.LEGACY_INSURANCE_PROXY_TARGET_URL = "https://updated-os-systems-nu.vercel.app/api/insurance-intake";
    process.env.ENABLE_LEGACY_PROXY = "true";
    global.fetch = async (url, options) => {
      expect(url).toBe("https://updated-os-systems-nu.vercel.app/api/insurance-intake");
      expect(options.method).toBe("POST");
      expect(options.headers.authorization).toBe("Bearer website-secret");
      expect(options.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(options.body.toString())).toMatchObject({
        insuranceCompanyName: validPayload.insuranceCompanyName,
        damageDescription: validPayload.damageDescription
      });

      return new Response(
        JSON.stringify({
          success: true,
          submissionId: "proxied-submission"
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    };

    const app = createApp();
    const response = await request(app)
      .post("/api/insurance-intake")
      .set("host", "updated-ui-brs-site.vercel.app")
      .set("authorization", "Bearer website-secret")
      .send({
        ...validPayload,
        insuranceCompanyName: "",
        damageDescription: "",
        insuranceCompany: validPayload.insuranceCompanyName,
        description: validPayload.damageDescription
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      submissionId: "proxied-submission"
    });

    delete process.env.LEGACY_INSURANCE_PROXY_HOSTS;
    delete process.env.LEGACY_INSURANCE_PROXY_TARGET_URL;
    delete process.env.ENABLE_LEGACY_PROXY;
  });
});
