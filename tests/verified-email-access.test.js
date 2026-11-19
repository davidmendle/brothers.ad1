import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const require = createRequire(import.meta.url);
const express = require("express");
const { createFirebaseRbacRouter } = require("../lib/firebase-rbac-routes");

function authFixture(emailVerified, adminConfigured) {
  const now = Math.floor(Date.now() / 1000);
  const identity = {
    uid: "owner-uid",
    email: "david@brothersrestoration.org",
    email_verified: emailVerified,
    auth_time: now,
    iat: now - 5,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com" }
  };
  if (emailVerified === undefined) delete identity.email_verified;
  const auth = {
    verifyIdToken: vi.fn(async () => identity),
    verifySessionCookie: vi.fn(async () => identity),
    createSessionCookie: vi.fn(async () => "verified-owner-session")
  };
  const getFirestore = vi.fn(() => {
    if (emailVerified === true && !adminConfigured) return null;
    throw new Error("Unverified identities must not reach account storage.");
  });
  const app = express();
  app.use(express.json());
  app.use(createFirebaseRbacRouter({
    express,
    parseCookies: (header = "") => Object.fromEntries(
      String(header).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2)
    ),
    jsonError: (response, status, message) => response.status(status).json({ success: false, message }),
    getFirebaseAuth: () => auth,
    getFirebasePublicConfig: () => ({ enabled: true, adminConfigured, webConfigured: true }),
    getFirestore,
    isFirebaseConfigured: () => true
  }).router);
  return { app, auth, getFirestore };
}

beforeEach(() => {
  vi.stubEnv("FIREBASE_OWNER_ONLY_LOGIN", "true");
  vi.stubEnv("FIREBASE_ALLOWED_LOGIN_EMAILS", "david@brothersrestoration.org");
  vi.stubEnv("FIREBASE_OWNER_UID", "owner-uid");
  vi.stubEnv("FIREBASE_ALLOWED_SIGN_IN_PROVIDERS", "google.com");
});
afterEach(() => vi.unstubAllEnvs());

describe.each([false, true])("verified email boundary (Admin configured: %s)", (adminConfigured) => {
  it.each([undefined, false, null, "true", 1])("rejects email_verified=%s before creating a login session", async (emailVerified) => {
    const { app, auth, getFirestore } = authFixture(emailVerified, adminConfigured);
    const response = await request(app).post("/api/auth/session/login").send({ idToken: "signed-google-id-token" });
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/verified Google email/);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(auth.verifyIdToken).toHaveBeenCalledWith("signed-google-id-token", true);
    expect(auth.createSessionCookie).not.toHaveBeenCalled();
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it.each([undefined, false, null, "true", 1])("rejects email_verified=%s on an existing session", async (emailVerified) => {
    const { app, auth, getFirestore } = authFixture(emailVerified, adminConfigured);
    const response = await request(app).get("/api/auth/session").set("Cookie", "brothers_os_session=existing-session");
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/verified Google email/);
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("existing-session", true);
    expect(getFirestore).not.toHaveBeenCalled();
  });
});

it("preserves verified owner login and session checks without opening account storage", async () => {
  const { app, auth, getFirestore } = authFixture(true, false);
  const login = await request(app).post("/api/auth/session/login").send({ idToken: "signed-google-id-token" });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  expect(login.body.session.roleId).toBe("super_admin");
  expect(auth.createSessionCookie).toHaveBeenCalledOnce();
  const session = await request(app).get("/api/auth/session").set("Cookie", login.headers["set-cookie"]);
  expect(session.status).toBe(200);
  expect(session.body.session.email).toBe("david@brothersrestoration.org");
  expect(getFirestore).toHaveReturnedWith(null);
});
