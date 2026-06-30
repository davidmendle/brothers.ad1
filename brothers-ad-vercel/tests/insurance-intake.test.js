import fs from "fs";
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
    "FIREBASE_OWNER_ONLY_LOGIN"
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

  it("rejects non-owner Firebase Google sessions before Firestore access", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org";

    let firestoreTouched = false;
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
        adminConfigured: true,
        webConfigured: true
      }),
      getFirestore() {
        firestoreTouched = true;
        throw new Error("Firestore should not be reached for rejected owner-only logins.");
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
    expect(firestoreTouched).toBe(false);
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
