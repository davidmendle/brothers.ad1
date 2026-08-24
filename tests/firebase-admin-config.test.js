import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  buildWorkloadIdentityClientOptions,
  getFirebasePublicConfig,
  probeFirebaseAdminReadiness
} = require("../lib/firebase-admin");

const trackedKeys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_REST_AUTH_FALLBACK",
  "GCP_PROJECT_ID",
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
];
const originalValues = Object.fromEntries(trackedKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  trackedKeys.forEach((key) => {
    if (originalValues[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValues[key];
    }
  });
});

describe("Firebase production configuration", () => {
  it("does not report malformed service-account credentials as configured", () => {
    process.env.FIREBASE_PROJECT_ID = "brothers-restoration-website";
    process.env.FIREBASE_CLIENT_EMAIL = "not-a-service-account@example.com";
    process.env.FIREBASE_PRIVATE_KEY = "not-a-private-key";

    const config = getFirebasePublicConfig();

    expect(config.adminConfigured).toBe(false);
    expect(config.adminCredentialSource).toBe("");
    expect(config.missingAdminEnv).toContain("GCP_SERVICE_ACCOUNT_EMAIL");
  });

  it("accepts Vercel OIDC workload identity without a private key", () => {
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.GCP_PROJECT_ID = "brothers-restoration-website";
    process.env.GCP_PROJECT_NUMBER = "80592032671";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = "firebase-adminsdk-fbsvc@brothers-restoration-website.iam.gserviceaccount.com";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";

    const config = getFirebasePublicConfig();

    expect(config.adminConfigured).toBe(true);
    expect(config.adminCredentialSource).toBe("vercel-oidc");
    expect(config.missingAdminEnv).toEqual([]);
  });

  it("binds Vercel OIDC tokens to the canonical Google provider audience", async () => {
    const tokenSupplier = vi.fn(async () => "provider-bound-token");
    const options = buildWorkloadIdentityClientOptions({
      projectNumber: "80592032671",
      serviceAccountEmail: "firebase-adminsdk-fbsvc@brothers-restoration-website.iam.gserviceaccount.com",
      poolId: "vercel",
      providerId: "vercel"
    }, tokenSupplier);

    await expect(options.subject_token_supplier.getSubjectToken()).resolves.toBe("provider-bound-token");
    expect(options.audience).toBe("//iam.googleapis.com/projects/80592032671/locations/global/workloadIdentityPools/vercel/providers/vercel");
    expect(tokenSupplier).toHaveBeenCalledWith({
      audience: "https://iam.googleapis.com/projects/80592032671/locations/global/workloadIdentityPools/vercel/providers/vercel"
    });
  });

  it("probes the keyless identity and Firestore path without exposing the access token", async () => {
    const fetchImpl = vi.fn(async (_url, request) => ({ ok: true, status: 200, request }));
    const clientFactory = vi.fn(() => ({
      getAccessToken: vi.fn(async () => ({ token: "short-lived-google-token" }))
    }));

    const result = await probeFirebaseAdminReadiness({
      config: {
        projectId: "brothers-restoration-website",
        projectNumber: "80592032671",
        serviceAccountEmail: "firebase-adminsdk-fbsvc@brothers-restoration-website.iam.gserviceaccount.com",
        poolId: "vercel",
        providerId: "vercel"
      },
      tokenSupplier: vi.fn(async () => "vercel-oidc-token"),
      clientFactory,
      fetchImpl
    });

    expect(result).toEqual({
      ready: true,
      credentialSource: "vercel-oidc",
      projectId: "brothers-restoration-website",
      stage: "complete",
      reason: ""
    });
    expect(JSON.stringify(result)).not.toContain("short-lived-google-token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer short-lived-google-token");
  });

  it("returns a sanitized Firestore readiness failure", async () => {
    const result = await probeFirebaseAdminReadiness({
      config: {
        projectId: "brothers-restoration-website",
        projectNumber: "80592032671",
        serviceAccountEmail: "firebase-adminsdk-fbsvc@brothers-restoration-website.iam.gserviceaccount.com",
        poolId: "vercel",
        providerId: "vercel"
      },
      clientFactory: () => ({ getAccessToken: async () => ({ token: "sensitive-token" }) }),
      fetchImpl: async () => ({ ok: false, status: 403 })
    });

    expect(result).toEqual({
      ready: false,
      credentialSource: "vercel-oidc",
      projectId: "brothers-restoration-website",
      stage: "firestore-read",
      reason: "firestore-read-failed"
    });
    expect(JSON.stringify(result)).not.toContain("sensitive-token");
  });

  it("rejects workload identity credentials for another project", () => {
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.GCP_PROJECT_ID = "another-project";
    process.env.GCP_PROJECT_NUMBER = "80592032671";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = "firebase-adminsdk-fbsvc@another-project.iam.gserviceaccount.com";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";

    const config = getFirebasePublicConfig();

    expect(config.adminConfigured).toBe(false);
    expect(config.adminCredentialSource).toBe("");
  });

  it("locks authentication when the configured Firebase project does not match Brothers OS", () => {
    process.env.FIREBASE_PROJECT_ID = "wrong-firebase-project";
    process.env.FIREBASE_REST_AUTH_FALLBACK = "true";

    const config = getFirebasePublicConfig();

    expect(config.enabled).toBe(false);
    expect(config.webConfigured).toBe(false);
    expect(config.missingWebEnv).toContain("FIREBASE_PROJECT_ID");
  });
});
