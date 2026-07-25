import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getFirebasePublicConfig } = require("../lib/firebase-admin");

const trackedKeys = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_REST_AUTH_FALLBACK"
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
    expect(config.missingAdminEnv).toContain("FIREBASE_SERVICE_ACCOUNT_JSON_OR_VALID_CREDENTIALS");
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
