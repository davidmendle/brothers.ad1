import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function manualTimeRouterFixture({ employeeOverrides = {}, extraUsers = {}, extraWorkspace = {}, grants = {} } = {}) {
  const activeUser = { companyId: "default-company", franchiseIds: ["franchise-a"], status: "active", disabled: false };
  const users = {
    "owner-uid": { ...activeUser, roleId: "super_admin", email: "david@brothersrestoration.org" },
    "office-uid": { ...activeUser, roleId: "business_owner", email: "office@example.com", permissionsOverride: { pages: { mode: "allow", allowed: ["time", "team", "jobs", "equipment"] } } },
    "limited-office-uid": { ...activeUser, roleId: "business_owner", email: "limited-office@example.com", permissionsOverride: { pages: { mode: "allow", allowed: ["time", "team", "equipment"] } } },
    "limited-franchise-uid": { ...activeUser, roleId: "franchise_owner", email: "limited-franchise@example.com", permissionsOverride: { pages: { mode: "allow", allowed: ["time", "team", "equipment"] } } },
    "franchise-uid": { ...activeUser, roleId: "franchise_owner", email: "franchise@example.com" },
    "contractor-uid": { ...activeUser, roleId: "contractor", email: "contractor@example.com", contractorId: "contractor-a" },
    "employee-uid": {
      ...activeUser, roleId: "worker", email: "employee@example.com", displayName: "Employee One", contractorId: "contractor-a",
      employerContractorId: "contractor-a", employmentStatus: "active", assignedJobIds: ["job-a"], assignedTaskIds: ["task-a"],
      ...employeeOverrides
    },
    ...extraUsers
  };
  const jobs = Object.fromEntries([
    ["job-a", "contractor-a", "franchise-a"],
    ["job-b", "contractor-b", "franchise-a"],
    ["job-c", "contractor-a", "franchise-b"],
    ["job-unassigned", "contractor-a", "franchise-a"]
  ].map(([id, contractorId, franchiseId]) => [id, {
    companyId: "default-company", field: "jobBoards", recordId: id,
    data: { id, jobId: id.toUpperCase(), title: `Saved ${id}`, contractorId, franchiseId },
    deletedAt: "", updatedAt: "2026-01-01T00:00:00.000Z"
  }]));
  const fakeDb = createFakeFirestore({ osUsers: users, osWorkspaceRecords: {
    ...jobs,
    "task-a": {
      companyId: "default-company", field: "tasks", recordId: "task-a", deletedAt: "", updatedAt: "2026-01-01T00:00:00.000Z",
      data: { id: "task-a", moduleKey: "jobs", jobId: "job-a", contractorId: "contractor-a", franchiseId: "franchise-a", status: "Open" }
    },
    ...extraWorkspace
  }, osAccessGrants: grants });
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const { router } = createFirebaseRbacRouter({
    express,
    parseCookies: (header = "") => Object.fromEntries(String(header).split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2)),
    jsonError: (response, statusCode, message) => response.status(statusCode).json({ success: false, message }),
    getFirebaseAuth: () => ({
      verifySessionCookie: async (uid) => freshGoogleIdentity({ uid, email: users[uid]?.email }),
      getUser: async (uid) => ({ uid, ...users[uid] }),
      setCustomUserClaims: async () => undefined
    }),
    getFirebasePublicConfig: () => ({ enabled: true, adminConfigured: true, webConfigured: true }),
    getFirestore: () => fakeDb,
    isFirebaseConfigured: () => true
  });
  app.use(router);
  const read = (uid = "owner-uid") => request(app).get("/api/workspace-state").set("Cookie", [`brothers_os_session=${uid}`]);
  const write = async (workspaceState, uid = "owner-uid") => {
    const before = await read(uid);
    expect(before.status).toBe(200);
    return request(app).put("/api/workspace-state").set("Cookie", [`brothers_os_session=${uid}`])
      .send({ baseRevision: before.body.revision, baseUpdatedAt: before.body.updatedAt, workspaceState });
  };
  const entry = {
    id: "manual-time-1", entryMethod: "manual", workerId: "employee-uid", workerEmail: "employee@example.com",
    worker: "Employee One", contractorId: "contractor-a", franchiseId: "franchise-a", job: "job-a", taskId: "task-a", task: "Extraction",
    billable: true, start: "2026-01-10T09:00:00.000Z", end: "2026-01-10T17:00:00.000Z", breakMinutes: 30, notes: "Office-entered approved shift"
  };
  return { app, fakeDb, read, write, entry };
}

function workspaceWriteSnapshot(fakeDb) {
  return structuredClone(Object.fromEntries(
    ["osWorkspaceRecords", "osWorkspaceSettings", "osWorkspaceRevisions", "osAuditLogs"]
      .map((collection) => [collection, fakeDb.dump(collection)])
  ));
}

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

function freshGoogleIdentity(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    uid: "owner-uid",
    email: "david@brothersrestoration.org",
    email_verified: true,
    name: "David",
    auth_time: now,
    iat: now - 5,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com" },
    ...overrides
  };
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
  let transactionQueue = Promise.resolve();
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
    runTransaction(callback) {
      const run = transactionQueue.then(async () => {
        const operations = [];
        const result = await callback({
          get: async (ref) => ref.get(),
          set(ref, data, options) {
            operations.push(() => ref.set(data, options));
          }
        });
        for (const operation of operations) await operation();
        return result;
      });
      transactionQueue = run.catch(() => undefined);
      return run;
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
    "FIREBASE_OWNER_UID",
    "FIREBASE_OWNER_ONLY_LOGIN",
    "SUPER_ADMIN_EMAILS"
  ].forEach((key) => {
    delete process.env[key];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  db.close();
});

describe("manual time workspace router", () => {
  it.each(["owner-uid", "office-uid", "franchise-uid"])("persists authorized office time for %s with calculated hours and server audit", async (uid) => {
    const { write, read, entry } = manualTimeRouterFixture();
    const response = await write({ timeEntries: [{ ...entry, hours: "9000", enteredByUid: "forged", enteredAt: "forged", startGps: { latitude: 1 } }] }, uid);
    expect(response.status).toBe(200);
    const stored = (await read()).body.workspaceState.timeEntries[0];
    expect(stored).toMatchObject({ hours: "7.50", startGps: null, endGps: null, enteredByUid: uid, applicationId: "general-contracting" });
    expect(Number.isFinite(Date.parse(stored.enteredAt))).toBe(true);
    expect(stored.enteredAt).not.toBe("forged");
  });
  it.each(["employee-uid", "contractor-uid"])("rejects new manual entries from %s without any workspace writes", async (uid) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = fakeDb.dump("osWorkspaceRecords");
    const response = await write({ timeEntries: [{ ...entry, roleId: "super_admin", enteredByUid: "owner-uid" }] }, uid);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/office administrator/);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
  });
  it.each([
    { end: "2026-01-10T08:00:00Z" }, { end: "2026-01-11T09:00:01Z" },
    { end: "2099-01-10T17:00:00Z", start: "2099-01-10T09:00:00Z" },
    { start: "2026-02-30T09:00:00Z" }, { breakMinutes: 480 }, { notes: "" }
  ])("rejects invalid manual time atomically: %j", async (change) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ priceItems: [{ id: "must-not-save", name: "Atomicity probe" }], timeEntries: [{ ...entry, ...change }] });
    expect(response.status).toBe(400);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });
  it.each([
    [{ companyId: "other-company" }, {}, "owner-uid"],
    [{ franchiseIds: ["franchise-b"] }, {}, "franchise-uid"],
    [{ contractorId: "contractor-b", employerContractorId: "contractor-b" }, {}, "office-uid"],
    [{ disabled: true }, {}, "office-uid"],
    [{}, { workerEmail: "foreign@example.com" }, "office-uid"],
    [{}, { companyId: "other-company" }, "owner-uid"],
    [{}, { workerId: "unknown-employee" }, "owner-uid"]
  ])("rejects foreign or invalid directory membership %j", async (employeeOverrides, change, uid) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture({ employeeOverrides });
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ timeEntries: [{ ...entry, ...change }] }, uid);
    expect(response.status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });
  it("accepts a persisted team profile but not one invented inside the same update", async () => {
    const member = { id: "local-worker", name: "Office Employee", email: "local@example.com", contractorId: "contractor-a", franchiseId: "franchise-a", status: "Active" };
    const { write, read, entry } = manualTimeRouterFixture();
    const timeEntry = { ...entry, workerId: member.id, workerEmail: member.email, worker: member.name };
    expect((await write({ teamMembers: [member], timeEntries: [timeEntry] })).status).toBe(403);
    expect((await write({ teamMembers: [member] })).status).toBe(200);
    expect((await write({ timeEntries: [timeEntry] }, "franchise-uid")).status).toBe(200);
    expect((await read()).body.workspaceState.timeEntries[0].worker).toBe(member.name);
  });
  it("accepts an authorized pending employee invitation", async () => {
    const { write, entry } = manualTimeRouterFixture({ grants: { "pending-1": {
      companyId: "default-company", franchiseIds: ["franchise-a"], contractorId: "contractor-a", employerContractorId: "contractor-a",
      email: "pending@example.com", displayName: "Pending Employee", status: "issued", onboardingMode: "employee_link", expiresAt: "2099-01-01T00:00:00Z"
    } } });
    expect((await write({ timeEntries: [{ ...entry, workerId: "invite-pending-1", workerEmail: "pending@example.com" }] }, "franchise-uid")).status).toBe(200);
  });
  it.each(["employee-uid", "contractor-uid"])("preserves existing immutable manual entries on %s round-trips", async (uid) => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture();
    expect((await write({ timeEntries: [entry] })).status).toBe(200);
    const saved = (await read(uid)).body.workspaceState.timeEntries[0];
    expect(saved.id).toBe(entry.id);
    const before = structuredClone(fakeDb.dump("osWorkspaceRecords"));
    const response = await write({ timeEntries: [{ ...saved, entryMethod: "gps", hours: "999", notes: "unauthorized change", enteredByUid: "forged" }] }, uid);
    expect(response.status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
  });
  it("preserves entered audit on office edits and leaves unchanged office round-trips alone", async () => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture();
    expect((await write({ timeEntries: [entry] })).status).toBe(200);
    const original = (await read()).body.workspaceState.timeEntries[0];
    expect((await write({ timeEntries: [{ ...original, end: "2026-01-10T18:00:00Z", enteredByUid: "forged", enteredAt: "forged" }] }, "office-uid")).status).toBe(200);
    const updated = (await read()).body.workspaceState.timeEntries[0];
    expect(updated).toMatchObject({ hours: "8.50", enteredByUid: original.enteredByUid, enteredAt: original.enteredAt, updatedByUid: "office-uid", updatedByEmail: "office@example.com" });
    const before = structuredClone(fakeDb.dump("osWorkspaceRecords"));
    expect((await write({ timeEntries: [updated] }, "office-uid")).status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
  });
  it("does not relax GPS time entry or active shift requirements for workers", async () => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const legacy = { ...entry };
    delete legacy.entryMethod;
    expect((await write({ activeClockSessions: [legacy] }, "employee-uid")).status).toBe(400);
    expect((await write({ timeEntries: [legacy] }, "employee-uid")).status).toBe(409);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    expect((await write({ timeEntries: [legacy] })).status).toBe(200);
    expect((await write({ timeEntries: [entry] })).status).toBe(409);
  });
  it("keeps historical manual time unchanged when another module saves after an employee becomes inactive", async () => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture();
    expect((await write({ timeEntries: [entry] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.timeEntries[0];
    const [documentId, before] = Object.entries(fakeDb.dump("osWorkspaceRecords"))
      .find(([, stored]) => stored.field === "timeEntries");
    const original = structuredClone(before);
    await fakeDb.collection("osUsers").doc("employee-uid").set({ disabled: true, status: "inactive" }, { merge: true });
    const response = await write({ timeEntries: [saved], priceItems: [{ id: "unrelated-price", name: "New pricing line" }] });
    expect(response.status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")[documentId]).toEqual(original);
    expect(Object.values(fakeDb.dump("osWorkspaceRecords")).some((stored) => stored.recordId === "unrelated-price")).toBe(true);
    expect((await write({ timeEntries: [{ ...saved, notes: "Actual manual time edit" }] })).status).toBe(403);
    expect(fakeDb.dump("osWorkspaceRecords")[documentId]).toEqual(original);
  });
  it.each(["priceItems", "timeEntries", "files"])("rejects more than 2500 raw %s records before truncating or writing", async (field) => {
    const { write, fakeDb } = manualTimeRouterFixture();
    expect((await write({ priceItems: [{ id: "existing-price", name: "Keep me" }] })).status).toBe(200);
    const recordsBefore = structuredClone(fakeDb.dump("osWorkspaceRecords"));
    const revisionsBefore = structuredClone(fakeDb.dump("osWorkspaceRevisions"));
    const response = await write({ accountProfile: { name: "Must not update" }, [field]: Array.from({ length: 2501 }, (_, index) => ({ id: `item-${index}` })) });
    expect(response.status).toBe(413);
    expect(response.body.message).toMatch(/2500-record limit/);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(recordsBefore);
    expect(fakeDb.dump("osWorkspaceRevisions")).toEqual(revisionsBefore);
    expect(fakeDb.dump("osWorkspaceSettings")).toEqual({});
  });

  it("canonicalizes consistent saved job aliases and derives their scope", async () => {
    const { write, read, entry } = manualTimeRouterFixture();
    const { franchiseId, ...unscoped } = entry;
    const response = await write({ timeEntries: [{ ...unscoped, job: "JOB-A Saved job-a", jobId: "job-a", relatedJob: "Saved job-a" }] });
    expect(response.status).toBe(200);
    expect((await read()).body.workspaceState.timeEntries[0]).toMatchObject({
      job: "JOB-A", jobId: "job-a", relatedJob: "JOB-A", companyId: "default-company", franchiseId, contractorId: "contractor-a"
    });
  });

  it.each(["owner-uid", "office-uid"])("accepts company employee time on a persisted branch-only owner job for %s without inventing a franchise", async (uid) => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture({ employeeOverrides: {
      franchiseIds: [], contractorId: "", employerContractorId: ""
    } });
    const job = { id: "branch-only-job", jobId: "COMPANY-100", title: "Company branch repair", branchId: "company-branch" };
    expect((await write({ jobBoards: [job] })).status).toBe(200);
    const persistedJob = (await read()).body.workspaceState.jobBoards.find((item) => item.id === job.id);
    expect(persistedJob).toMatchObject(job);
    expect(persistedJob).not.toHaveProperty("franchiseId");
    expect(persistedJob).not.toHaveProperty("contractorId");
    const timeEntry = {
      ...entry, job: persistedJob.jobId, jobId: persistedJob.id, relatedJob: persistedJob.jobId,
      franchiseId: "", branchId: persistedJob.branchId, contractorId: ""
    };
    expect((await write({ timeEntries: [timeEntry] }, uid)).status).toBe(200);
    const saved = (await read()).body.workspaceState.timeEntries[0];
    expect(saved).toMatchObject({
      companyId: "default-company", franchiseId: "", branchId: job.branchId, contractorId: "",
      workerId: entry.workerId, job: job.jobId, jobId: job.id, relatedJob: job.jobId, hours: "7.50", enteredByUid: uid
    });
    const before = workspaceWriteSnapshot(fakeDb);
    for (const change of [
      { franchiseId: job.branchId }, { branchId: "other-branch" },
      { contractorId: "contractor-a" }, { companyId: "other-company" }
    ]) {
      const response = await write({ timeEntries: [saved, { ...timeEntry, id: "invalid-scope-entry", ...change }] }, uid);
      expect(response.status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("does not treat a matching branch ID as franchise authority for manual-time edits", async () => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture({ employeeOverrides: {
      franchiseIds: ["franchise-a"], contractorId: "", employerContractorId: ""
    } });
    const job = { id: "branch-only-job", jobId: "COMPANY-100", title: "Company branch repair", branchId: "franchise-a" };
    expect((await write({ jobBoards: [job] })).status).toBe(200);
    expect((await write({ timeEntries: [{
      ...entry, job: job.jobId, jobId: job.id, relatedJob: job.jobId,
      franchiseId: "", branchId: job.branchId, contractorId: ""
    }] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.timeEntries[0];
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ timeEntries: [{ ...saved, notes: "Franchise owner edit" }] }, "franchise-uid");
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/saved employee.*franchise workspace/);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["office-uid", "franchise-uid"])("rejects cross-contractor and cross-franchise saved jobs for %s", async (uid) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = workspaceWriteSnapshot(fakeDb);
    for (const change of [{ job: "job-b" }, { job: "job-b", contractorId: "contractor-b" }, { job: "job-c" }, { job: "job-c", franchiseId: "franchise-b" }]) {
      expect((await write({ timeEntries: [{ ...entry, ...change }] }, uid)).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it.each(["limited-office-uid", "limited-franchise-uid"])("requires saved job module access for %s", async (uid) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ timeEntries: [entry] }, uid);
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/saved assigned job/);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each([{ job: "missing-job" }, { jobId: "job-b" }, { relatedJob: "job-b" }, { jobId: ["job-a"] }])("rejects missing or inconsistent job references: %j", async (change) => {
    const { write, fakeDb, entry } = manualTimeRouterFixture();
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ priceItems: [{ id: "atomic-probe" }], timeEntries: [{ ...entry, ...change }] })).status).toBe(400);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it("rejects ambiguous, deleted, foreign-company, and unsaved same-batch jobs", async () => {
    for (const kind of ["ambiguous", "deleted", "foreign", "same-batch"]) {
      const fixture = manualTimeRouterFixture();
      const job = fixture.fakeDb.dump("osWorkspaceRecords")["job-a"];
      if (kind === "ambiguous") await fixture.fakeDb.collection("osWorkspaceRecords").doc("duplicate-job").set(job);
      else await fixture.fakeDb.collection("osWorkspaceRecords").doc("job-a").set({
        ...job, ...(kind === "foreign" ? { companyId: "other-company" } : { deletedAt: "2026-01-02T00:00:00Z" })
      });
      const before = workspaceWriteSnapshot(fixture.fakeDb);
      const response = await fixture.write({ timeEntries: [fixture.entry], ...(kind === "same-batch" ? { jobBoards: [job.data] } : {}) });
      expect(response.status).toBe(kind === "ambiguous" ? 409 : 400);
      expect(workspaceWriteSnapshot(fixture.fakeDb)).toEqual(before);
    }
  });

  it("round-trips unchanged historical manual time after job deletion or access removal", async () => {
    const { write, read, fakeDb, entry } = manualTimeRouterFixture();
    expect((await write({ timeEntries: [entry] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.timeEntries[0];
    await fakeDb.collection("osWorkspaceRecords").doc("job-a").set({ deletedAt: "2026-01-11T00:00:00Z" }, { merge: true });
    const before = fakeDb.dump("osWorkspaceRecords");
    expect((await write({ timeEntries: [saved] }, "limited-office-uid")).status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
    expect((await write({ timeEntries: [{ ...saved, notes: "Changed history" }] })).status).toBe(400);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
  });
});

describe("branch-only employee workspace router", () => {
  async function fixture({ employeeOverrides = {}, assignedTaskIds = ["task-a"] } = {}) {
    const employerId = "employer-david_brothersrestoration_org";
    const job = { id: "job-a", jobId: "OWNER-100", title: "Owner branch job", contractorId: employerId, branchId: "owner-branch" };
    const task = { id: "task-a", moduleKey: "jobs", relatedJob: job.jobId, contractorId: employerId, branchId: job.branchId, status: "Open" };
    const extraWorkspace = Object.fromEntries([
      ["jobBoards", job],
      ["jobBoards", { ...job, id: "job-unassigned", jobId: "OWNER-200" }],
      ["tasks", task],
      ["tasks", { ...task, id: "task-other-branch", branchId: "other-branch" }],
      ["tasks", { ...task, id: "task-foreign", contractorId: "contractor-b" }],
      ["photoRecords", { id: "hidden-photo", jobId: "JOB-B", contractorId: "contractor-b", branchId: job.branchId }]
    ].map(([field, data]) => [data.id, {
      companyId: "default-company", field, recordId: data.id, data, deletedAt: "", updatedAt: "2026-01-01T00:00:00.000Z"
    }]));
    const extraUsers = { "owner-uid": {
      roleId: "super_admin", email: "david@brothersrestoration.org", companyId: "default-company", franchiseIds: [], status: "active", disabled: false
    } };
    const issuing = manualTimeRouterFixture({ extraWorkspace, extraUsers });
    const invitation = await request(issuing.app).post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=owner-uid"])
      .send({ email: "branch.employee@example.com", displayName: "Branch Employee", franchiseIds: [],
        assignedJobIds: [job.jobId], assignedTaskIds, employeeModuleIds: ["jobs", "time", "photos", "equipment", "drylogs"], sendEmail: false });
    expect(invitation.status).toBe(201);
    const grant = invitation.body.grant;
    expect(grant).toMatchObject({ contractorId: employerId, employerContractorId: employerId, franchiseIds: [] });
    // Exercise the invite-issued scope keys without requiring a live Google login.
    const workerScope = Object.fromEntries([
      "email", "displayName", "franchiseIds", "contractorId", "employerContractorId", "employerUid", "employerEmail",
      "assignedJobIds", "assignedTaskIds", "assignedJobScopeKeys", "assignedTaskScopeKeys", "visiblePageIds", "visibleTabIds"
    ].map((key) => [key, grant[key]]));
    return { ...manualTimeRouterFixture({ extraWorkspace, extraUsers, employeeOverrides: { ...workerScope, ...employeeOverrides } }), job, task, employerId };
  }

  it("preserves the trusted branch on GPS clock-in/out, photo, dry-log, and support-file writes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    try {
      const { write, read, job, task, employerId } = await fixture();
      const initial = await read("employee-uid");
      expect(initial.body.workspaceState.jobBoards.some((item) => item.id === job.id)).toBe(true);
      const startGps = { latitude: 40, longitude: -73, accuracy: 5 };
      expect((await write({ activeClockSessions: [{
        id: "branch-shift", job: job.jobId, taskId: task.id, start: "2000-01-01T00:00:00Z", startGps
      }] }, "employee-uid")).status).toBe(200);
      const clock = (await read("employee-uid")).body.workspaceState.activeClockSessions[0];
      expect(clock).toMatchObject({ branchId: job.branchId, contractorId: employerId, companyId: "default-company", workerId: "employee-uid", start: "2026-11-01T10:00:00.000Z" });
      expect(clock.franchiseId || "").toBe("");

      expect((await write({
        photoRecords: [{ id: "branch-photo", jobId: job.jobId, taskId: task.id, assetId: "photo-asset" }],
        dryLogs: [{ id: "branch-dry-log", jobId: job.jobId, moisture: 15 }],
        files: [{ id: "branch-photo-file", moduleKey: "photos", sourceType: "photoEvidence", relatedJob: job.jobId, taskId: task.id }]
      }, "employee-uid")).status).toBe(200);
      const afterPhoto = (await read("employee-uid")).body.workspaceState;
      for (const field of ["photoRecords", "dryLogs", "files"]) {
        expect(afterPhoto[field][0]).toMatchObject({ companyId: "default-company", branchId: job.branchId, contractorId: employerId, workerId: "employee-uid" });
        expect(afterPhoto[field][0].franchiseId || "").toBe("");
      }

      vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
      expect((await write({
        activeClockSessions: [],
        timeEntries: [{ ...clock, endGps: { latitude: 40.01, longitude: -73.01 }, hours: "999" }],
        files: [{ id: "branch-time-file", moduleKey: "time", sourceType: "timeEntry", relatedJob: job.jobId, taskId: task.id }]
      }, "employee-uid")).status).toBe(200);
      const afterClockOut = (await read("employee-uid")).body.workspaceState;
      expect(afterClockOut.activeClockSessions || []).toEqual([]);
      expect(afterClockOut.timeEntries[0]).toMatchObject({ branchId: job.branchId, contractorId: employerId, hours: "2.00", start: clock.start, end: "2026-11-01T12:00:00.000Z", workerId: "employee-uid" });
      expect(afterClockOut.files.find((item) => item.id === "branch-time-file")).toMatchObject({ branchId: job.branchId, contractorId: employerId });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves branch-only scope for task-only references and combined equipment/support saves", async () => {
    const { write, read, job, task, employerId } = await fixture();
    expect((await write({ photoRecords: [{ id: "task-photo", taskId: task.id }] }, "employee-uid")).status).toBe(200);
    expect((await read("employee-uid")).body.workspaceState.photoRecords[0]).toMatchObject({ branchId: job.branchId, contractorId: employerId });
    expect((await write({
      equipmentDeployments: [{ id: "branch-equipment", equipmentName: "Dehumidifier", assetTag: "BRANCH-1", jobId: job.id, job: job.jobId,
        deployedAt: "2026-01-10T09:00:00Z", dailyRate: 0, billable: false }],
      files: [{ id: "branch-equipment-file", moduleKey: "equipment", sourceType: "equipmentDeployment", sourceId: "branch-equipment", relatedJob: job.jobId }]
    }, "employee-uid")).status).toBe(200);
    const saved = (await read("employee-uid")).body.workspaceState;
    for (const record of [saved.equipmentDeployments[0], saved.files.find((item) => item.id === "branch-equipment-file")]) {
      expect(record).toMatchObject({ branchId: job.branchId, contractorId: employerId });
      expect(record.franchiseId || "").toBe("");
    }
  });

  it.each([
    { jobId: "OWNER-200", taskId: "" },
    { jobId: "JOB-B", taskId: "" },
    { jobId: "missing-job", taskId: "" },
    { jobId: "JOB-B" },
    { relatedJob: "JOB-B" },
    { taskId: "task-foreign" },
    { companyId: "other-company" },
    { contractorId: "contractor-b" },
    { employerContractorId: "contractor-b" },
    { franchiseId: "owner-branch" },
    { branchId: "other-branch" },
    { jobId: "", taskId: "", workerId: "employee-uid" },
    { id: "hidden-photo", jobId: "JOB-B", taskId: "" }
  ])("rejects inaccessible assignments or client scope without workspace writes: %j", async (change) => {
    const { write, fakeDb, job, task } = await fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({
      files: [{ id: "atomic-branch-file", moduleKey: "photos", relatedJob: job.jobId }],
      photoRecords: [{ id: "rejected-photo", jobId: job.jobId, taskId: task.id, ...change }]
    }, "employee-uid");
    expect(response.status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["activeClockSessions", "timeEntries", "files"])("does not authorize %s through an assigned task paired with an inaccessible job", async (field) => {
    const { write, fakeDb, task } = await fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ [field]: [{ id: "mixed-assignment", moduleKey: "time", jobId: "JOB-B", taskId: task.id, startGps: { latitude: 40, longitude: -73 }, endGps: { latitude: 40, longitude: -73 } }] }, "employee-uid");
    expect(response.status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it("rejects ambiguous or conflicting saved assignment scopes atomically", async () => {
    for (const ambiguous of [false, true]) {
      const { write, fakeDb, job } = await fixture({ assignedTaskIds: ["task-a", "task-other-branch"] });
      if (ambiguous) await fakeDb.collection("osWorkspaceRecords").doc("duplicate-branch-job").set(fakeDb.dump("osWorkspaceRecords")["job-a"]);
      const before = workspaceWriteSnapshot(fakeDb);
      const response = await write({ photoRecords: [{ id: "conflicting-photo", jobId: job.jobId, ...(ambiguous ? {} : { taskId: "task-other-branch" }) }] }, "employee-uid");
      expect(response.status).toBe(409);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("does not preserve assignment scope after the worker loses job module access", async () => {
    const { write, fakeDb, job } = await fixture({ employeeOverrides: { visiblePageIds: ["photos"], visibleTabIds: ["photos"] } });
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ photoRecords: [{ id: "no-job-access", jobId: job.jobId }] }, "employee-uid")).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });
});

describe("equipment lifecycle workspace router", () => {
  function fixture(options) {
    return {
      ...manualTimeRouterFixture(options),
      deployment: {
        id: "equipment-1", equipmentName: "Dehumidifier", assetTag: "ASSET 1", jobId: "job-a", job: "JOB-A",
        contractorId: "contractor-a", franchiseId: "franchise-a", deployedAt: "2026-01-10T09:00:00.000Z",
        billable: false, dailyRate: 0, status: "Deployed", rentalDays: 0
      }
    };
  }

  const readonlyWorker = { permissionsOverride: {
    pages: { mode: "allow", allowed: ["equipment", "jobs"] },
    actions: { editAssignedTasks: false, editAllTasks: false }
  } };

  function supportFile(deployment, changes = {}) {
    return {
      id: "equipment-support", moduleKey: "equipment", sourceType: "equipmentDeployment", sourceId: deployment.id,
      type: "Equipment deployment", title: "Deployment support", amount: 0, status: "Deployed",
      contractorId: deployment.contractorId, franchiseId: deployment.franchiseId,
      jobId: deployment.jobId, relatedJob: deployment.job, ...changes
    };
  }

  it("saves full read-only worker snapshots through deployment, return, and unchanged round-trips", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: readonlyWorker, extraWorkspace: {
      "read-only-file": { companyId: "default-company", field: "files", recordId: "read-only-file", data: {
        id: "read-only-file", moduleKey: "jobs", sourceType: "jobPacket", relatedJob: "JOB-A", contractorId: "contractor-a", franchiseId: "franchise-a", notes: "Owner-owned packet"
      } }
    } });
    const initial = (await read("employee-uid")).body.workspaceState;
    const originalRows = structuredClone(fakeDb.dump("osWorkspaceRecords"));
    expect(initial.jobBoards.length).toBeGreaterThan(0);
    expect(initial.tasks.length).toBeGreaterThan(0);
    expect((await write({ ...initial, equipmentDeployments: [deployment], files: [...initial.files, supportFile(deployment)] }, "employee-uid")).status).toBe(200);
    for (const id of ["job-a", "task-a", "read-only-file"]) expect(fakeDb.dump("osWorkspaceRecords")[id]).toEqual(originalRows[id]);
    let snapshot = (await read("employee-uid")).body.workspaceState;
    const savedFile = snapshot.files.find((file) => file.id === "equipment-support");
    expect(savedFile).toMatchObject({ sourceId: deployment.id, jobId: "job-a", relatedJob: "JOB-A", amount: 0, workerId: "employee-uid", status: "Deployed" });
    expect((await write({ files: [{ ...savedFile, amount: 125 }] })).status).toBe(200);
    snapshot = (await read("employee-uid")).body.workspaceState;
    const returned = { ...snapshot.equipmentDeployments[0], returnedAt: "2026-01-11T09:00:00Z", status: "Returned", rentalDays: 999 };
    const response = await write({ ...snapshot, equipmentDeployments: [returned], files: snapshot.files.map((file) => file.id === savedFile.id
      ? { ...file, status: "Complete", notes: "Returned to inventory", updatedAt: "forged" } : file) }, "employee-uid");
    expect(response.status).toBe(200);
    snapshot = (await read("employee-uid")).body.workspaceState;
    expect(snapshot.equipmentDeployments[0]).toMatchObject({ rentalDays: 1, status: "Returned" });
    expect(snapshot.files.find((file) => file.id === savedFile.id)).toMatchObject({ amount: 125, status: "Complete", sourceId: deployment.id, notes: "Returned to inventory" });
    expect(snapshot.files.find((file) => file.id === savedFile.id).updatedAt).not.toBe("forged");
    const beforeNoop = structuredClone(fakeDb.dump("osWorkspaceRecords"));
    expect((await write(snapshot, "employee-uid")).status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(beforeNoop);
  });

  it.each([
    { sourceId: "missing-deployment" },
    { sourceId: "equipment-2" },
    { sourceType: "equipmentInvoice" },
    { moduleKey: "payments" },
    { type: "Invoice" },
    { amount: 500 },
    { invoiceId: "invoice-forged" },
    { paymentUrl: "https://pay.example.test/forged" },
    { dailyRate: 500 },
    { contractorId: "contractor-b" },
    { companyId: "other-company" },
    { franchiseId: "franchise-b" },
    { branchId: "other-branch" },
    { relatedJob: "JOB-B" }
  ])("rejects full-snapshot support-file forgery atomically: %j", async (change) => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: readonlyWorker });
    expect((await write({ equipmentDeployments: [deployment, { ...deployment, id: "equipment-2", assetTag: "ASSET 2" }], files: [supportFile(deployment)] })).status).toBe(200);
    const snapshot = (await read("employee-uid")).body.workspaceState;
    const before = workspaceWriteSnapshot(fakeDb);
    const response = await write({ ...snapshot, files: snapshot.files.map((file) => ({ ...file, ...change })) }, "employee-uid");
    expect([400, 403]).toContain(response.status);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it("does not grant arbitrary file, job, task, or invoice writes with equipment permission", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: readonlyWorker });
    expect((await write({ equipmentDeployments: [deployment], files: [supportFile(deployment)] })).status).toBe(200);
    const snapshot = (await read("employee-uid")).body.workspaceState;
    const before = workspaceWriteSnapshot(fakeDb);
    for (const change of [
      { files: [{ id: "arbitrary-file", moduleKey: "equipment", relatedJob: "JOB-A", contractorId: "contractor-a", franchiseId: "franchise-a", sourceType: "custom" }] },
      { files: [{ ...supportFile(deployment), id: "new-forged-billing", amount: 500 }] },
      { files: [{ ...supportFile(deployment), id: "new-forged-link", sourceId: "missing" }] },
      { jobBoards: snapshot.jobBoards.map((job) => ({ ...job, title: "Forbidden edit" })) },
      { tasks: snapshot.tasks.map((task) => ({ ...task, status: "Complete" })) },
      { files: [{ ...supportFile(deployment), id: "invoice", moduleKey: "payments", sourceType: "equipmentInvoice", type: "Invoice" }] }
    ]) {
      expect((await write({ ...snapshot, ...change }, "employee-uid")).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("rejects unchanged inaccessible records and cannot convert a stored invoice into support", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: readonlyWorker });
    const invoice = { ...supportFile(deployment), id: "private-invoice", moduleKey: "payments", sourceType: "equipmentInvoice", type: "Invoice", amount: 125 };
    expect((await write({ equipmentDeployments: [deployment], files: [invoice] })).status).toBe(200);
    const snapshot = (await read("employee-uid")).body.workspaceState;
    const ownerView = (await read()).body.workspaceState;
    const before = workspaceWriteSnapshot(fakeDb);
    for (const change of [
      { jobBoards: [...snapshot.jobBoards, ownerView.jobBoards.find((job) => job.id === "job-b")] },
      { files: ownerView.files },
      { files: [supportFile(deployment, { id: invoice.id })] }
    ]) {
      expect((await write({ ...snapshot, ...change }, "employee-uid")).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("requires deployment and job authorization and validates same-batch equipment before support writes", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: readonlyWorker });
    const foreign = { ...deployment, id: "foreign-equipment", jobId: "job-b", job: "JOB-B", contractorId: "contractor-b" };
    expect((await write({ equipmentDeployments: [foreign] })).status).toBe(200);
    const snapshot = (await read("employee-uid")).body.workspaceState;
    const before = workspaceWriteSnapshot(fakeDb);
    for (const file of [supportFile(foreign), supportFile(deployment, { sourceId: foreign.id })]) {
      expect((await write({ ...snapshot, files: [file] }, "employee-uid")).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
    expect((await write({ ...snapshot, equipmentDeployments: [{ ...deployment, deployedAt: "invalid" }], files: [supportFile(deployment)] }, "employee-uid")).status).toBe(400);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["owner-uid", "office-uid", "franchise-uid", "employee-uid", "contractor-uid"])("validates markerless deployment through the route for %s", async (uid) => {
    const { write, read, deployment } = fixture();
    const response = await write({ equipmentDeployments: [{ ...deployment, deployedByUid: "forged", createdAt: "forged" }] }, uid);
    expect(response.status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    expect(saved).toMatchObject({ ...deployment, companyId: "default-company", lifecycleVersion: 1, deployedByUid: uid, rentalDays: 0 });
    expect(Number.isFinite(Date.parse(saved.createdAt))).toBe(true);
    expect(saved.createdAt).not.toBe("forged");
  });

  it("allows equipment placement and return with job read access while task and job editing stay forbidden", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: {
      permissionsOverride: {
        pages: { mode: "allow", allowed: ["equipment", "jobs"] },
        actions: { editAssignedTasks: false, editAllTasks: false }
      }
    } });
    const workerView = await read("employee-uid");
    const job = workerView.body.workspaceState.jobBoards.find((item) => item.id === "job-a");
    expect(job).toBeDefined();
    expect(fakeDb.dump("osUsers")["employee-uid"].permissionsOverride.actions).toEqual({ editAssignedTasks: false, editAllTasks: false });
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ jobBoards: [{ ...job, title: "Forbidden job edit" }] }, "employee-uid")).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    expect((await write({ tasks: [{ id: "task-a", moduleKey: "jobs", jobId: "job-a", contractorId: "contractor-a", franchiseId: "franchise-a", status: "Complete" }] }, "employee-uid")).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    expect((await write({ equipmentDeployments: [deployment] }, "employee-uid")).status).toBe(200);
    const saved = (await read("employee-uid")).body.workspaceState.equipmentDeployments[0];
    expect((await write({ equipmentDeployments: [{ ...saved, returnedAt: "2026-01-11T09:00:00Z", status: "Returned" }] }, "employee-uid")).status).toBe(200);
    expect((await read()).body.workspaceState.equipmentDeployments[0]).toMatchObject({ status: "Returned", rentalDays: 1, returnedByUid: "employee-uid" });
    expect(fakeDb.dump("osWorkspaceRecords")["job-a"].data.title).toBe("Saved job-a");
  });

  it("still requires equipment module permission when a worker can read the assigned job", async () => {
    const { write, read, fakeDb, deployment } = fixture({ employeeOverrides: {
      permissionsOverride: { pages: { mode: "allow", allowed: ["jobs"] }, actions: { editAssignedTasks: false } }
    } });
    expect((await read("employee-uid")).body.workspaceState.jobBoards.some((item) => item.id === "job-a")).toBe(true);
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [deployment] }, "employee-uid")).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each([{ assetTag: "" }, { deployedAt: "invalid" }, { deployedAt: "2099-01-01T00:00:00Z" }, { rentalDays: 9 }, { status: "Returned" }, { returnedAt: "2026-01-12T09:00:00Z" }, { job: "job-b" }, { relatedJob: "job-b" }, { jobId: "missing" }])("rejects invalid new deployments without a lifecycle marker: %j", async (change) => {
    const { write, fakeDb, deployment } = fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [{ ...deployment, ...change }], accountProfile: { name: "Atomic probe" } })).status).toBe(400);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["owner-uid", "office-uid", "franchise-uid", "employee-uid", "contractor-uid"])("rejects a saved job in a different contractor inventory for %s", async (uid) => {
    const { write, fakeDb, deployment } = fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [{ ...deployment, job: "JOB-B", jobId: "job-b" }] }, uid)).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["limited-office-uid", "limited-franchise-uid", "employee-uid"])("validates saved job authorization for %s, not posted identity", async (uid) => {
    const { write, fakeDb, deployment } = fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    const change = uid === "employee-uid" ? { jobId: "job-unassigned", job: "JOB-UNASSIGNED", workerId: uid, createdByUid: uid } : {};
    expect((await write({ equipmentDeployments: [{ ...deployment, ...change }] }, uid)).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it("derives canonical job scope and supports distinct contractor inventories", async () => {
    const { write, read, deployment } = fixture();
    const { contractorId, franchiseId, ...unscoped } = deployment;
    expect((await write({ equipmentDeployments: [unscoped, { ...unscoped, id: "equipment-2", jobId: "job-b", job: "JOB-B" }] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments;
    expect(saved[0]).toMatchObject({ contractorId, franchiseId, companyId: "default-company", branchId: "" });
    expect(saved[1]).toMatchObject({ contractorId: "contractor-b", assetTag: deployment.assetTag });
  });

  it("rejects active duplicates from saved records, even when omitted or invisible", async () => {
    const { write, fakeDb, deployment } = fixture();
    const hidden = { ...deployment, id: "old-equipment", franchiseId: "franchise-b", branchId: "another-branch", status: "Needs pickup", assetTag: " asset   1 " };
    await fakeDb.collection("osWorkspaceRecords").doc("hidden-equipment").set({
      companyId: "default-company", field: "equipmentDeployments", recordId: hidden.id, data: hidden, deletedAt: ""
    });
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [deployment] }, "employee-uid")).status).toBe(409);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each([false, true])("rejects duplicate assets or IDs in a single batch (same ID: %s)", async (sameId) => {
    const { write, fakeDb, deployment } = fixture();
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [deployment, { ...deployment, id: sameId ? deployment.id : "equipment-2", assetTag: " asset   1 " }] })).status).toBe(409);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it.each(["employee-uid", "contractor-uid"])("rejects new and existing billing forgeries from %s", async (uid) => {
    const { write, read, fakeDb, deployment } = fixture();
    const changes = [{ billable: true }, { dailyRate: 50 }, { invoiceId: "forged" }, { invoiceNumber: "forged" }, { billingReviewedAt: "2026-01-12T00:00:00Z" }, { billingReviewedByUid: "owner-uid" }];
    for (const change of changes) {
      const before = workspaceWriteSnapshot(fakeDb);
      expect((await write({ equipmentDeployments: [{ ...deployment, ...change }] }, uid)).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
    expect((await write({ equipmentDeployments: [{ ...deployment, billable: true, dailyRate: 95 }] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    for (const change of [{ billable: false }, ...changes.slice(1, -1), { billingReviewedByUid: "forged" }]) {
      const before = workspaceWriteSnapshot(fakeDb);
      expect((await write({ equipmentDeployments: [{ ...saved, ...change }] }, uid)).status).toBe(403);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("canonicalizes worker return duration and audit while retaining office billing", async () => {
    const { write, read, deployment } = fixture();
    expect((await write({ equipmentDeployments: [{ ...deployment, billable: true, dailyRate: 95 }] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    const response = await write({ equipmentDeployments: [{ ...saved, returnedAt: "2026-01-11T04:00:01-05:00", status: "Returned", rentalDays: 9999, returnedByUid: "forged", returnNotes: " Collected " }] }, "employee-uid");
    expect(response.status).toBe(200);
    const returned = (await read()).body.workspaceState.equipmentDeployments[0];
    expect(returned).toMatchObject({ rentalDays: 2, returnedAt: "2026-01-11T09:00:01.000Z", returnedByUid: "employee-uid", status: "Returned", returnNotes: "Collected", billable: true, dailyRate: 95, billingReviewedByUid: "owner-uid" });
    expect(returned.deployedAt).toBe(saved.deployedAt);
    expect((await write({ equipmentDeployments: [returned] }, "employee-uid")).status).toBe(200);
  });

  it("does not treat an existing equipment ID with omitted scope as a new deployment", async () => {
    const { write, read, fakeDb, deployment } = fixture();
    expect((await write({ equipmentDeployments: [{ ...deployment, billable: true, dailyRate: 95 }] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    const { companyId, contractorId, franchiseId, branchId, ...unscoped } = saved;
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [{ ...unscoped, assetTag: "replacement" }] })).status).toBe(409);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    expect((await write({ equipmentDeployments: [{ ...unscoped, billable: false, dailyRate: 0 }] }, "employee-uid")).status).toBe(403);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    expect((await write({ equipmentDeployments: [{ ...unscoped, returnedAt: "2026-01-11T09:00:00Z", status: "Returned" }] }, "employee-uid")).status).toBe(200);
    expect((await read()).body.workspaceState.equipmentDeployments[0]).toMatchObject({ companyId, contractorId, franchiseId, branchId, rentalDays: 1, dailyRate: 95 });
  });

  it("validates office billing changes, stamps server review, and preserves duration", async () => {
    const { write, read, fakeDb, deployment } = fixture();
    expect((await write({ equipmentDeployments: [deployment] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    expect((await write({ equipmentDeployments: [{ ...saved, dailyRate: "12.50", billable: true, billingReviewedByUid: "forged", billingReviewedAt: "forged", rentalDays: 999 }] }, "office-uid")).status).toBe(200);
    const reviewed = (await read()).body.workspaceState.equipmentDeployments[0];
    expect(reviewed).toMatchObject({ dailyRate: 12.5, billable: true, rentalDays: 0, billingReviewedByUid: "office-uid" });
    expect(Number.isFinite(Date.parse(reviewed.billingReviewedAt))).toBe(true);
    const before = workspaceWriteSnapshot(fakeDb);
    expect((await write({ equipmentDeployments: [{ ...reviewed, dailyRate: -5 }] }, "office-uid")).status).toBe(400);
    expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
  });

  it("rejects invalid returns, placement rewrites, and reopening without writes", async () => {
    const { write, read, fakeDb, deployment } = fixture();
    expect((await write({ equipmentDeployments: [deployment] })).status).toBe(200);
    const saved = (await read()).body.workspaceState.equipmentDeployments[0];
    for (const change of [{ returnedAt: "2026-01-09T00:00:00Z" }, { returnedAt: "2099-01-01T00:00:00Z" }, { returnedAt: "invalid" }, { deployedAt: "2026-01-01T00:00:00Z" }, { assetTag: "different" }, { job: "JOB-UNASSIGNED", jobId: "job-unassigned" }, { status: "Returned" }]) {
      const before = workspaceWriteSnapshot(fakeDb);
      expect((await write({ equipmentDeployments: [{ ...saved, ...change }] })).status).toBeGreaterThanOrEqual(400);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
    expect((await write({ equipmentDeployments: [{ ...saved, returnedAt: "2026-01-11T09:00:00Z", status: "Returned" }] })).status).toBe(200);
    const returned = (await read()).body.workspaceState.equipmentDeployments[0];
    const before = workspaceWriteSnapshot(fakeDb);
    for (const change of [{ returnedAt: "", status: "Deployed" }, { returnedAt: "2026-01-12T09:00:00Z" }]) {
      expect((await write({ equipmentDeployments: [{ ...returned, ...change }] })).status).toBe(409);
      expect(workspaceWriteSnapshot(fakeDb)).toEqual(before);
    }
  });

  it("allows a return and redeployment in either batch order, plus office invoice linking", async () => {
    for (const reverse of [false, true]) {
      const { write, read, deployment } = fixture();
      expect((await write({ equipmentDeployments: [{ ...deployment, billable: true, dailyRate: 95 }] })).status).toBe(200);
      const saved = (await read()).body.workspaceState.equipmentDeployments[0];
      const records = [{ ...saved, returnedAt: "2026-01-11T09:00:00Z", status: "Returned", invoiceId: "invoice-1", invoiceNumber: "INV-1" }, { ...deployment, id: "equipment-2", deployedAt: "2026-01-12T09:00:00Z" }];
      expect((await write({ equipmentDeployments: reverse ? records.reverse() : records })).status).toBe(200);
      expect((await read()).body.workspaceState.equipmentDeployments.find((item) => item.id === saved.id)).toMatchObject({ rentalDays: 1, invoiceId: "invoice-1" });
    }
  });

  it("round-trips unchanged markerless history, but validates any edit and upgrades a legacy return", async () => {
    const { write, read, fakeDb, deployment } = fixture();
    const legacy = { ...deployment, job: "deleted-job", jobId: "deleted-job", rentalDays: 77, dailyRate: "historical-rate" };
    delete legacy.deployedAt;
    await fakeDb.collection("osWorkspaceRecords").doc("legacy-equipment").set({ companyId: "default-company", field: "equipmentDeployments", recordId: legacy.id, data: legacy });
    const before = fakeDb.dump("osWorkspaceRecords");
    expect((await write({ equipmentDeployments: [legacy] }, "limited-office-uid")).status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
    expect((await write({ equipmentDeployments: [{ ...legacy, notes: "Edit" }] })).status).toBe(400);
    expect(fakeDb.dump("osWorkspaceRecords")).toEqual(before);
    const validLegacy = { ...legacy, job: "JOB-A", jobId: "job-a", dailyRate: 95, createdAt: deployment.deployedAt };
    await fakeDb.collection("osWorkspaceRecords").doc("legacy-equipment").set({ data: validLegacy }, { merge: true });
    expect((await write({ equipmentDeployments: [{ ...validLegacy, deployedAt: validLegacy.createdAt, returnedAt: "2026-01-11T09:00:00Z", status: "Returned" }] }, "employee-uid")).status).toBe(200);
    expect((await read()).body.workspaceState.equipmentDeployments[0]).toMatchObject({ lifecycleVersion: 1, rentalDays: 1, deployedAt: deployment.deployedAt });
  });
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
          "GCP_PROJECT_ID",
          "GCP_PROJECT_NUMBER",
          "GCP_SERVICE_ACCOUNT_EMAIL",
          "GCP_WORKLOAD_IDENTITY_POOL_ID",
          "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
        ],
        missingWebEnv: []
      },
      payments: {
        stripeConfigured: false,
        paypalConfigured: false,
        zelleConfigured: false,
        wireConfigured: false,
        quickBooksConfigured: false
      },
      insuranceIntake: {
        intakeEnabled: true,
        apiKeyConfigured: true,
        adminConfigured: true,
        adminAuthMode: "firebase-google",
        legacyAdminLoginEnabled: false,
        adminEmailsConfigured: 1,
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
          "Insurance submissions are using sqlite-file storage. Configure Firebase Admin credentials or BLOB_READ_WRITE_TOKEN for durable production storage on Vercel.",
          "Firebase auth/RBAC is not fully configured. Missing admin env: GCP_PROJECT_ID, GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID. Missing web env: none."
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
            auth_time: Math.floor(Date.now() / 1000),
            iat: Math.floor(Date.now() / 1000) - 5,
            exp: Math.floor(Date.now() / 1000) + 3600,
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

  it("never promotes an allowlisted non-owner through the REST fallback", async () => {
    process.env.FIREBASE_OWNER_ONLY_LOGIN = "true";
    process.env.FIREBASE_ALLOWED_LOGIN_EMAILS = "david@brothersrestoration.org,contractor@example.com";
    process.env.SUPER_ADMIN_EMAILS = "david@brothersrestoration.org,contractor@example.com";
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
          verifyIdToken: async () => freshGoogleIdentity({
            uid: "contractor-uid",
            email: "contractor@example.com",
            name: "Contractor"
          }),
          createSessionCookie: async () => {
            throw new Error("A fallback session must not be created for a non-owner.");
          }
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: false,
        webConfigured: true
      }),
      getFirestore: () => null,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-google-token" });

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/non-owner account/i);
  });

  it("clears stale trial restrictions when the verified owner signs in", async () => {
    process.env.FIREBASE_OWNER_UID = "owner-uid";
    const fakeDb = createFakeFirestore({
      osUsers: {
        "owner-uid": {
          email: "david@brothersrestoration.org",
          displayName: "David",
          roleId: "worker",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          contractorId: "expired-contractor",
          status: "expired",
          disabled: true,
          accessExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          accessGrantId: "old-grant",
          accessCodeId: "old-code",
          portalCodeHash: hashPortalCode("CON-OLD-CODE")
        }
      }
    });
    let savedClaims = null;
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
          verifyIdToken: async () => freshGoogleIdentity(),
          getUser: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            displayName: "David",
            disabled: false
          }),
          setCustomUserClaims: async (_uid, claims) => {
            savedClaims = claims;
          },
          createSessionCookie: async () => "owner-session-cookie"
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
      .send({ idToken: "verified-owner-google-token" });

    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({
      email: "david@brothersrestoration.org",
      roleId: "super_admin",
      accessExpiresAt: "",
      accessScope: "owner"
    });
    expect(fakeDb.dump("osUsers")["owner-uid"]).toMatchObject({
      roleId: "super_admin",
      status: "active",
      disabled: false,
      accessExpiresAt: "",
      accessGrantId: "",
      accessCodeId: "",
      portalCodeHash: "",
      contractorId: "",
      accessScope: "owner"
    });
    expect(savedClaims).toMatchObject({
      roleId: "super_admin",
      accessExpiresAt: "",
      contractorId: ""
    });
  });

  it("revokes a persisted Super Admin role from every non-owner Google account", async () => {
    const fakeDb = createFakeFirestore({
      osUsers: {
        "stale-admin-uid": {
          email: "contractor@example.com",
          displayName: "Stale Admin",
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
      parseCookies: () => ({}),
      jsonError(response, statusCode, message) {
        return response.status(statusCode).json({ success: false, message });
      },
      getFirebaseAuth() {
        return {
          verifyIdToken: async () => freshGoogleIdentity({
            uid: "stale-admin-uid",
            email: "contractor@example.com",
            name: "Stale Admin"
          }),
          getUser: async () => ({
            uid: "stale-admin-uid",
            email: "contractor@example.com",
            displayName: "Stale Admin",
            disabled: false
          }),
          setCustomUserClaims: async () => undefined,
          createSessionCookie: async () => {
            throw new Error("Unauthorized Super Admin must not receive a session cookie.");
          }
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
      .send({ idToken: "verified-non-owner-google-token" });

    expect(response.status).toBe(403);
    expect(fakeDb.dump("osUsers")["stale-admin-uid"]).toMatchObject({
      roleId: "worker",
      status: "pending_access",
      disabled: true,
      accessScope: "unapproved"
    });
  });

  it("keeps a valid owner session active when workspace context hydration fails", async () => {
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
    const baseCollection = fakeDb.collection.bind(fakeDb);
    fakeDb.collection = (collectionName) => {
      const collection = baseCollection(collectionName);
      if (collectionName !== "osTabs") return collection;
      return {
        ...collection,
        orderBy() {
          return {
            get: async () => {
              throw new Error("Simulated Firestore index outage");
            }
          };
        }
      };
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
          verifySessionCookie: async () => freshGoogleIdentity(),
          getUser: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            displayName: "David",
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
      .set("Cookie", ["brothers_os_session=owner-session-cookie"]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      contextStatus: "degraded",
      session: {
        email: "david@brothersrestoration.org",
        roleId: "super_admin"
      }
    });
    expect(response.body.tabs.length).toBeGreaterThan(0);
  });

  it("hydrates page sections without requiring a compound Firestore index", async () => {
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
    const baseCollection = fakeDb.collection.bind(fakeDb);
    fakeDb.collection = (collectionName) => {
      const collection = baseCollection(collectionName);
      if (collectionName !== "osPageSections") return collection;
      return {
        ...collection,
        orderBy() {
          throw new Error("A compound page-section index must not be required.");
        }
      };
    };
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
          verifySessionCookie: async () => freshGoogleIdentity(),
          getUser: async () => ({
            uid: "owner-uid",
            email: "david@brothersrestoration.org",
            displayName: "David",
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
      .set("Cookie", ["brothers_os_session=owner-session-cookie"]);

    expect(response.status).toBe(200);
    expect(response.body.contextStatus).toBe("ready");
    expect(response.body.pageSections.length).toBeGreaterThan(0);
  });

  it("requires a recent Google authentication before creating a session", async () => {
    let sessionCookieCreated = false;
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
          verifyIdToken: async () => freshGoogleIdentity({
            auth_time: Math.floor(Date.now() / 1000) - 10 * 60
          }),
          createSessionCookie: async () => {
            sessionCookieCreated = true;
            return "session-cookie";
          }
        };
      },
      getFirebasePublicConfig: () => ({
        enabled: true,
        adminConfigured: false,
        webConfigured: true
      }),
      getFirestore: () => null,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const response = await request(app)
      .post("/api/auth/session/login")
      .send({ idToken: "stale-google-token" });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/sign in with Google again/i);
    expect(sessionCookieCreated).toBe(false);
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
            auth_time: Math.floor(Date.now() / 1000),
            iat: Math.floor(Date.now() / 1000) - 5,
            exp: Math.floor(Date.now() / 1000) + 3600,
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
    expect(fakeDb.dump("osAccessGrants").grant1.tokenHash).toBe("");
    expect(fakeDb.dump("osUsers")["contractor-uid"].status).toBe("active");
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
            auth_time: Math.floor(Date.now() / 1000),
            iat: Math.floor(Date.now() / 1000) - 5,
            exp: Math.floor(Date.now() / 1000) + 3600,
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
            auth_time: Math.floor(Date.now() / 1000),
            iat: Math.floor(Date.now() / 1000) - 5,
            exp: Math.floor(Date.now() / 1000) + 3600,
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
    expect(fakeDb.dump("osUsers")["contractor-uid"].status).toBe("pending_access");
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

  it("persists workspace records and scopes them to assigned workers", async () => {
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
        },
        "worker-uid": {
          email: "worker@example.com",
          displayName: "Assigned Worker",
          roleId: "worker",
          companyId: "default-company",
          franchiseIds: ["default-franchise"],
          contractorId: "contractor-a",
          employerContractorId: "contractor-a",
          employerUid: "contractor-owner-uid",
          onboardingMode: "employee_link",
          accessScope: "employee_portal",
          employmentStatus: "active",
          assignedJobIds: ["J-ASSIGNED"],
          assignedTaskIds: ["TASK-ASSIGNED"],
          permissionsOverride: { actions: { viewGlobalIndexes: true } },
          visibleTabIds: ["jobs", "photos"],
          visiblePageIds: ["jobs", "photos"],
          status: "active",
          disabled: false
        }
      }
    });
    const users = {
      "owner-uid": {
        uid: "owner-uid",
        email: "david@brothersrestoration.org",
        displayName: "David",
        disabled: false
      },
      "worker-uid": {
        uid: "worker-uid",
        email: "worker@example.com",
        displayName: "Assigned Worker",
        disabled: false
      }
    };
    const app = express();
    app.use(express.json({ limit: "5mb" }));
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
          verifySessionCookie: async (cookie) => cookie === "worker-cookie"
            ? freshGoogleIdentity({
                uid: "worker-uid",
                email: "worker@example.com",
                name: "Assigned Worker"
              })
            : freshGoogleIdentity(),
          getUser: async (uid) => users[uid],
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

    const saveResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"])
      .send({
        baseRevision: "",
        baseUpdatedAt: "",
        workspaceState: {
          files: [
            { id: "file-assigned", moduleKey: "jobs", relatedJob: "J-ASSIGNED", contractorId: "contractor-a", title: "Assigned file", accessCode: "DO-NOT-STORE" },
            { id: "file-other", moduleKey: "jobs", relatedJob: "J-OTHER", contractorId: "contractor-b", title: "Other file" },
            { id: "file-invoice", sourceType: "contractorInvoice", moduleKey: "jobs", relatedJob: "J-ASSIGNED", contractorId: "contractor-a", title: "Canonical contractor invoice" },
            { id: "file-standards", sourceType: "standardsOutput", moduleKey: "compliance", relatedJob: "J-ASSIGNED", contractorId: "contractor-a", title: "Compliance review" },
            { id: "file-module-record", sourceType: "moduleRecord", moduleKey: "reports", relatedJob: "J-ASSIGNED", contractorId: "contractor-a", title: "Financial report" }
          ],
          moduleRecords: [
            { id: "record-assigned", moduleKey: "jobs", linkedModuleKeys: ["photos"], relatedJob: "J-ASSIGNED", contractorId: "contractor-a", subject: "Assigned job record" },
            { id: "record-hidden", moduleKey: "dispatch", linkedModuleKeys: ["routeplanner"], relatedJob: "J-ASSIGNED", contractorId: "contractor-a", subject: "Hidden assigned dispatch" },
            { id: "record-other", moduleKey: "dispatch", linkedModuleKeys: ["routeplanner"], relatedJob: "J-OTHER", contractorId: "contractor-b", subject: "Other dispatch" }
          ],
          photoRecords: [
            { id: "photo-assigned", jobId: "J-ASSIGNED", taskId: "TASK-ASSIGNED", contractorId: "contractor-a", workerEmail: "worker@example.com" },
            { id: "photo-other", jobId: "J-OTHER", contractorId: "contractor-b", workerEmail: "other@example.com" }
          ],
          contractorBills: [
            { id: "bill-1", invoiceId: "CINV-1", contractorId: "contractor-a", contractorEmail: "contractor@example.com", jobId: "J-ASSIGNED", amount: 1250 }
          ],
          estimateDraft: {
            estimateNo: "EST-TEST",
            customer: "Workspace Customer",
            privateKey: "DO-NOT-STORE"
          }
        }
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.savedRecords).toBe(11);

    const storedWorkspaceRecords = Object.values(fakeDb.dump("osWorkspaceRecords"));
    expect(storedWorkspaceRecords.find((stored) => stored.data?.id === "record-assigned")).toEqual(
      expect.objectContaining({
        applicationId: "general-contracting",
        applicationIds: ["general-contracting"],
        applicationContractVersion: 1,
        data: expect.objectContaining({
          applicationId: "general-contracting",
          applicationContractVersion: 1
        })
      })
    );
    expect(storedWorkspaceRecords.find((stored) => stored.data?.id === "bill-1")).toEqual(
      expect.objectContaining({ applicationId: "finance-and-reporting" })
    );
    expect(storedWorkspaceRecords.find((stored) => stored.data?.id === "file-invoice")).toEqual(
      expect.objectContaining({
        applicationId: "finance-and-reporting",
        data: expect.objectContaining({ moduleKey: "payments" })
      })
    );
    expect(storedWorkspaceRecords.find((stored) => stored.data?.id === "file-standards")).toEqual(
      expect.objectContaining({
        applicationId: "restoration-claims",
        data: expect.objectContaining({ moduleKey: "compliance" })
      })
    );
    expect(storedWorkspaceRecords.find((stored) => stored.data?.id === "file-module-record")).toEqual(
      expect.objectContaining({
        applicationId: "finance-and-reporting",
        data: expect.objectContaining({ moduleKey: "reports" })
      })
    );
    await fakeDb.collection("osWorkspaceSettings").doc("setting-estimate").set({
      companyId: "default-company",
      field: "estimateDraft",
      value: { estimateNo: "EST-GLOBAL" },
      updatedAt: "2026-08-01T10:00:00.000Z"
    });
    await fakeDb.collection("osWorkspaceAssets").doc("asset-photo-1").set({
      id: "asset-photo-1",
      companyId: "default-company",
      jobId: "J-ASSIGNED",
      contractorId: "contractor-a",
      fileName: "kitchen.jpg",
      updatedAt: "2026-08-01T11:00:00.000Z"
    });

    const ownerResponse = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"]);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.durable).toBe(true);
    expect(ownerResponse.body.workspaceState.files).toHaveLength(5);
    expect(ownerResponse.body.workspaceState.moduleRecords).toHaveLength(3);
    expect(ownerResponse.body.workspaceState.files[0].accessCode).toBeUndefined();
    expect(ownerResponse.body.workspaceState.estimateDraft.privateKey).toBeUndefined();
    expect(ownerResponse.body.workspaceState.contractorBills[0].invoiceId).toBe("CINV-1");

    const unregisteredModuleWrite = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"])
      .send({
        baseRevision: ownerResponse.body.revision,
        baseUpdatedAt: ownerResponse.body.updatedAt,
        workspaceState: {
          moduleRecords: [{ id: "unregistered-record", moduleKey: "unregistered-module", subject: "Must remain unowned" }]
        }
      });
    expect(unregisteredModuleWrite.status).toBe(403);
    expect(Object.values(fakeDb.dump("osWorkspaceRecords")).map((stored) => stored.data?.id))
      .not.toContain("unregistered-record");

    const ownerContextResponse = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=owner-cookie"]);
    expect(ownerContextResponse.status).toBe(200);
    expect(ownerContextResponse.body.applicationGlobalIndex).toEqual(expect.objectContaining({
      durable: true,
      applicationContractVersion: 1,
      totalRecords: expect.any(Number),
      applications: expect.any(Array)
    }));
    expect(ownerContextResponse.body.applicationGlobalIndex.applications.find(
      (application) => application.applicationId === "general-contracting"
    )).toEqual(expect.objectContaining({
      recordCount: 8,
      fields: expect.objectContaining({ workspaceAssets: 1 })
    }));
    expect(ownerContextResponse.body.applicationGlobalIndex.applications.find(
      (application) => application.applicationId === "workforce"
    ).recordCount).toBeGreaterThanOrEqual(2);
    expect(ownerContextResponse.body.applicationGlobalIndex.applications.find(
      (application) => application.applicationId === "command-governance"
    ).recordCount).toBeGreaterThan(0);
    const restorationIndexFields = ownerContextResponse.body.applicationGlobalIndex.applications.find(
      (application) => application.applicationId === "restoration-claims"
    ).fields;
    expect(restorationIndexFields["workspaceSettings.estimateDraft"]).toBeGreaterThan(0);
    expect(restorationIndexFields.workspaceAssets).toBe(1);
    expect(ownerContextResponse.body.applicationGlobalIndex.applicationRecordLinks)
      .toBeGreaterThanOrEqual(ownerContextResponse.body.applicationGlobalIndex.totalRecords);

    const workerResponse = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-cookie"]);
    expect(workerResponse.status).toBe(200);
    expect(workerResponse.body.workspaceState.files.map((file) => file.id)).toEqual(["file-assigned"]);
    expect(workerResponse.body.workspaceState.moduleRecords.map((record) => record.id)).toEqual(["record-assigned"]);
    expect(workerResponse.body.workspaceState.photoRecords.map((photo) => photo.id)).toEqual(["photo-assigned"]);
    expect(workerResponse.body.workspaceState.contractorBills).toBeUndefined();
    expect(workerResponse.body.workspaceState.estimateDraft).toBeUndefined();

    const workerContextResponse = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=worker-cookie"]);
    expect(workerContextResponse.status).toBe(200);
    expect(workerContextResponse.body.applicationGlobalIndex).toBeNull();
    expect(workerContextResponse.body.applications.map((application) => application.id)).not.toContain("command-governance");

    const workerCanonicalWrite = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-cookie"])
      .send({
        baseRevision: ownerResponse.body.revision,
        baseUpdatedAt: ownerResponse.body.updatedAt,
        workspaceState: {
          files: [{
            id: "file-assigned",
            sourceType: "jobNote",
            moduleKey: "globalindexes",
            linkedModuleKeys: ["globalindexes"],
            relatedJob: "J-ASSIGNED",
            contractorId: "contractor-a",
            title: "Worker job note"
          }]
        }
      });
    expect(workerCanonicalWrite.status).toBe(200);
    const canonicalWorkerFile = Object.values(fakeDb.dump("osWorkspaceRecords"))
      .find((stored) => stored.data?.id === "file-assigned");
    expect(canonicalWorkerFile).toEqual(expect.objectContaining({
      applicationId: "general-contracting",
      applicationIds: ["general-contracting"],
      data: expect.objectContaining({
        moduleKey: "jobs",
        linkedModuleKeys: []
      })
    }));

    const workerWrite = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-cookie"])
      .send({
        baseRevision: workerCanonicalWrite.body.revision,
        baseUpdatedAt: workerCanonicalWrite.body.updatedAt,
        workspaceState: {
          moduleRecords: [{ id: "record-assigned", moduleKey: "jobs", relatedJob: "J-ASSIGNED", subject: "Worker replacement" }],
          files: [{ id: "file-spoof", moduleKey: "jobs", relatedJob: "J-OTHER", workerEmail: "worker@example.com", title: "Spoofed file" }]
        }
      });
    expect(workerWrite.status).toBe(403);
    expect(workerWrite.body.message).toMatch(/no records were saved/i);

    const ownerAfterWorkerWrite = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"]);
    expect(ownerAfterWorkerWrite.body.workspaceState.moduleRecords).toContainEqual(
      expect.objectContaining({ id: "record-assigned", subject: "Assigned job record" })
    );
    expect(ownerAfterWorkerWrite.body.workspaceState.files.map((file) => file.id)).not.toContain("file-spoof");

    await fakeDb.collection("osWorkspaceRecords").doc("legacy-unowned-document").set({
      companyId: "default-company",
      field: "moduleRecords",
      recordId: "legacy-unowned-record",
      applicationId: "",
      applicationIds: [],
      data: { id: "legacy-unowned-record", moduleKey: "retired-module", subject: "Legacy data awaiting migration" },
      sortIndex: 99,
      deletedAt: "",
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    await fakeDb.collection("osWorkspaceRecords").doc("legacy-unowned-file-document").set({
      companyId: "default-company",
      field: "files",
      recordId: "legacy-unowned-file",
      applicationId: "",
      applicationIds: [],
      data: { id: "legacy-unowned-file", moduleKey: "retired-module", title: "Legacy file awaiting migration" },
      sortIndex: 99,
      deletedAt: "",
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    await fakeDb.collection("osWorkspaceRecords").doc("legacy-unowned-task-file-document").set({
      companyId: "default-company",
      field: "files",
      recordId: "legacy-unowned-task-file",
      applicationId: "",
      applicationIds: [],
      data: {
        id: "legacy-unowned-task-file",
        moduleKey: "team",
        sourceType: "taskAssignment",
        taskModuleKey: "retired-module",
        title: "Legacy task-assignment file awaiting migration"
      },
      sortIndex: 100,
      deletedAt: "",
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    await fakeDb.collection("osWorkspaceRecords").doc("legacy-unowned-task-document").set({
      companyId: "default-company",
      field: "tasks",
      recordId: "legacy-unowned-task",
      applicationId: "",
      applicationIds: [],
      data: { id: "legacy-unowned-task", moduleKey: "retired-module", title: "Legacy task awaiting migration" },
      sortIndex: 99,
      deletedAt: "",
      updatedAt: "2026-08-05T12:00:00.000Z"
    });
    const ownerWithLegacy = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"]);
    const legacyRecord = ownerWithLegacy.body.workspaceState.moduleRecords.find((record) => record.id === "legacy-unowned-record");
    expect(legacyRecord).toEqual(expect.objectContaining({ moduleKey: "retired-module" }));
    const legacyFile = ownerWithLegacy.body.workspaceState.files.find((record) => record.id === "legacy-unowned-file");
    const legacyTaskFile = ownerWithLegacy.body.workspaceState.files.find((record) => record.id === "legacy-unowned-task-file");
    const legacyTask = ownerWithLegacy.body.workspaceState.tasks.find((record) => record.id === "legacy-unowned-task");
    expect(legacyFile).toEqual(expect.objectContaining({ title: "Legacy file awaiting migration" }));
    expect(legacyTaskFile).toEqual(expect.objectContaining({ taskModuleKey: "retired-module" }));
    expect(legacyTask).toEqual(expect.objectContaining({ title: "Legacy task awaiting migration" }));

    const legacyRoundTrip = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"])
      .send({
        baseRevision: ownerWithLegacy.body.revision,
        baseUpdatedAt: ownerWithLegacy.body.updatedAt,
        workspaceState: {
          moduleRecords: [
            ...ownerWithLegacy.body.workspaceState.moduleRecords,
            { id: "registered-after-legacy", moduleKey: "jobs", subject: "Valid record saved beside legacy data" }
          ],
          files: ownerWithLegacy.body.workspaceState.files,
          tasks: ownerWithLegacy.body.workspaceState.tasks
        }
      });
    expect(legacyRoundTrip.status).toBe(200);
    expect(fakeDb.dump("osWorkspaceRecords")["legacy-unowned-document"].data.subject).toBe("Legacy data awaiting migration");
    expect(fakeDb.dump("osWorkspaceRecords")["legacy-unowned-file-document"].data).toEqual(legacyFile);
    expect(fakeDb.dump("osWorkspaceRecords")["legacy-unowned-task-file-document"].data).toEqual(legacyTaskFile);
    expect(fakeDb.dump("osWorkspaceRecords")["legacy-unowned-task-document"].data).toEqual(legacyTask);
    expect(Object.values(fakeDb.dump("osWorkspaceRecords")).find((stored) => stored.data?.id === "registered-after-legacy"))
      .toEqual(expect.objectContaining({ applicationId: "general-contracting" }));

    const legacyModification = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"])
      .send({
        baseRevision: legacyRoundTrip.body.revision,
        baseUpdatedAt: legacyRoundTrip.body.updatedAt,
        workspaceState: {
          moduleRecords: [{ ...legacyRecord, subject: "Forbidden legacy modification" }]
        }
      });
    expect(legacyModification.status).toBe(403);
    expect(fakeDb.dump("osWorkspaceRecords")["legacy-unowned-document"].data.subject).toBe("Legacy data awaiting migration");

    const ownerContextWithLegacy = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=owner-cookie"]);
    expect(ownerContextWithLegacy.body.applicationGlobalIndex.unownedRecordCount).toBe(4);
  });

  it("persists measured walls and fails closed across franchise workspace scopes", async () => {
    const fakeDb = createFakeFirestore({
      osUsers: {
        "owner-uid": {
          email: "david@brothersrestoration.org",
          displayName: "David",
          roleId: "super_admin",
          companyId: "default-company",
          franchiseIds: ["franchise-a", "franchise-b"],
          status: "active",
          disabled: false
        },
        "business-owner-uid": {
          email: "business@example.com",
          displayName: "Business Owner",
          roleId: "business_owner",
          companyId: "default-company",
          franchiseIds: ["franchise-a", "franchise-b"],
          status: "active",
          disabled: false
        },
        "franchise-a-uid": {
          email: "owner-a@example.com",
          displayName: "Franchise A",
          roleId: "franchise_owner",
          companyId: "default-company",
          franchiseIds: ["franchise-a"],
          status: "active",
          disabled: false
        },
        "franchise-b-uid": {
          email: "owner-b@example.com",
          displayName: "Franchise B",
          roleId: "franchise_owner",
          companyId: "default-company",
          franchiseIds: ["franchise-b"],
          status: "active",
          disabled: false
        },
        "multi-franchise-uid": {
          email: "multi@example.com",
          displayName: "Multi Franchise",
          roleId: "franchise_owner",
          companyId: "default-company",
          franchiseIds: ["franchise-a", "franchise-b"],
          status: "active",
          disabled: false
        }
      }
    });
    const users = {
      "owner-uid": { uid: "owner-uid", email: "david@brothersrestoration.org", displayName: "David", disabled: false },
      "business-owner-uid": { uid: "business-owner-uid", email: "business@example.com", displayName: "Business Owner", disabled: false },
      "franchise-a-uid": { uid: "franchise-a-uid", email: "owner-a@example.com", displayName: "Franchise A", disabled: false },
      "franchise-b-uid": { uid: "franchise-b-uid", email: "owner-b@example.com", displayName: "Franchise B", disabled: false },
      "multi-franchise-uid": { uid: "multi-franchise-uid", email: "multi@example.com", displayName: "Multi Franchise", disabled: false }
    };
    const identities = {
      "owner-cookie": freshGoogleIdentity(),
      "business-owner-cookie": freshGoogleIdentity({ uid: "business-owner-uid", email: "business@example.com", name: "Business Owner" }),
      "franchise-a-cookie": freshGoogleIdentity({ uid: "franchise-a-uid", email: "owner-a@example.com", name: "Franchise A" }),
      "franchise-b-cookie": freshGoogleIdentity({ uid: "franchise-b-uid", email: "owner-b@example.com", name: "Franchise B" }),
      "multi-franchise-cookie": freshGoogleIdentity({ uid: "multi-franchise-uid", email: "multi@example.com", name: "Multi Franchise" })
    };
    const app = express();
    app.use(express.json({ limit: "5mb" }));
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
          verifySessionCookie: async (cookie) => identities[cookie],
          getUser: async (uid) => users[uid],
          setCustomUserClaims: async () => undefined
        };
      },
      getFirebasePublicConfig: () => ({ enabled: true, adminConfigured: true, webConfigured: true }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const seedResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=owner-cookie"])
      .send({
        baseRevision: "",
        baseUpdatedAt: "",
        workspaceState: {
          branches: [
            { id: "branch-a", name: "Branch A", franchiseId: "franchise-a" },
            { id: "branch-b", name: "Branch B", franchiseId: "franchise-b" }
          ],
          sketchRooms: [
            { id: "legacy-unscoped-room", name: "Legacy Room" },
            { id: "room-a", name: "Room A", franchiseId: "franchise-a" },
            { id: "room-b", name: "Room B", franchiseId: "franchise-b" }
          ],
          sketchWalls: [
            { id: "predictable-wall-id", franchiseId: "franchise-a", start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, notes: "Franchise A original" },
            { id: "predictable-wall-id", franchiseId: "franchise-b", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, notes: "Franchise B original" }
          ],
          skillPacks: [{ id: "owner-skill-pack", name: "Super Admin standards" }],
          dataVaults: [{ id: "owner-data-vault", name: "Super Admin global data" }]
        }
      });

    expect(seedResponse.status).toBe(200);
    expect(seedResponse.body.savedRecords).toBe(9);

    const businessOwnerWorkspace = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=business-owner-cookie"]);
    expect(businessOwnerWorkspace.status).toBe(200);
    expect(businessOwnerWorkspace.body.workspaceState.skillPacks || []).toEqual([]);
    expect(businessOwnerWorkspace.body.workspaceState.dataVaults || []).toEqual([]);

    for (const cookie of ["business-owner-cookie", "franchise-a-cookie"]) {
      const forgedPrimaryApplication = await request(app)
        .put("/api/workspace-state")
        .set("Cookie", [`brothers_os_session=${cookie}`])
        .send({
          baseRevision: seedResponse.body.revision,
          baseUpdatedAt: seedResponse.body.updatedAt,
          workspaceState: {
            files: [{
              id: `forged-global-file-${cookie}`,
              moduleKey: "globalindexes",
              franchiseId: "franchise-a",
              title: "Must not become a global-index record"
            }]
          }
        });
      expect(forgedPrimaryApplication.status).toBe(403);
      expect(forgedPrimaryApplication.body.message).toMatch(/no records were saved/i);

      const forgedCanonicalGlobalRecord = await request(app)
        .put("/api/workspace-state")
        .set("Cookie", [`brothers_os_session=${cookie}`])
        .send({
          baseRevision: seedResponse.body.revision,
          baseUpdatedAt: seedResponse.body.updatedAt,
          workspaceState: {
            skillPacks: [{
              id: `forged-skill-pack-${cookie}`,
              franchiseId: "franchise-a",
              name: "Must remain Super Admin only"
            }]
          }
        });
      expect(forgedCanonicalGlobalRecord.status).toBe(403);
      expect(forgedCanonicalGlobalRecord.body.message).toMatch(/no records were saved/i);
    }

    const franchiseAResponse = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-a-cookie"]);
    expect(franchiseAResponse.status).toBe(200);
    expect(franchiseAResponse.body.workspaceState.sketchRooms.map((room) => room.id)).toEqual(["room-a"]);
    expect(franchiseAResponse.body.workspaceState.sketchWalls.map((wall) => wall.id)).toEqual(["predictable-wall-id"]);
    expect(franchiseAResponse.body.workspaceState.skillPacks || []).toEqual([]);
    expect(franchiseAResponse.body.workspaceState.dataVaults || []).toEqual([]);

    const franchiseBResponse = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-b-cookie"]);
    expect(franchiseBResponse.status).toBe(200);
    expect(franchiseBResponse.body.workspaceState.sketchRooms.map((room) => room.id)).toEqual(["room-b"]);
    expect(franchiseBResponse.body.workspaceState.sketchWalls.map((wall) => wall.id)).toEqual(["predictable-wall-id"]);

    const collisionAttemptResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-a-cookie"])
      .send({
        baseRevision: seedResponse.body.revision,
        baseUpdatedAt: seedResponse.body.updatedAt,
        workspaceState: {
          sketchWalls: [{
            id: "predictable-wall-id",
            franchiseId: "franchise-a",
            start: { x: 0, y: 0 },
            end: { x: 12, y: 0 },
            notes: "Franchise A updated"
          }]
        }
      });
    expect(collisionAttemptResponse.status).toBe(200);
    expect(collisionAttemptResponse.body).toMatchObject({ savedRecords: 1, ignoredRecords: 0 });
    const franchiseBAfterCollision = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-b-cookie"]);
    expect(franchiseBAfterCollision.body.workspaceState.sketchWalls).toEqual([
      expect.objectContaining({ id: "predictable-wall-id", notes: "Franchise B original", end: { x: 10, y: 0 } })
    ]);

    const autoScopeResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-a-cookie"])
      .send({
        baseRevision: collisionAttemptResponse.body.revision,
        baseUpdatedAt: collisionAttemptResponse.body.updatedAt,
        workspaceState: {
          sketchWalls: [{ id: "wall-a-new", start: { x: 8, y: 0 }, end: { x: 8, y: 6 } }]
        }
      });
    expect(autoScopeResponse.status).toBe(200);
    expect(autoScopeResponse.body).toMatchObject({ savedRecords: 1, ignoredRecords: 0 });
    const storedAutoScopedWall = Object.values(fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "sketchWalls" && record.data?.id === "wall-a-new");
    expect(storedAutoScopedWall.data.franchiseId).toBe("franchise-a");

    const foreignScopeResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-a-cookie"])
      .send({
        baseRevision: autoScopeResponse.body.revision,
        baseUpdatedAt: autoScopeResponse.body.updatedAt,
        workspaceState: {
          sketchWalls: [{ id: "wall-foreign", franchiseId: "franchise-b" }]
        }
      });
    expect(foreignScopeResponse.status).toBe(403);
    expect(foreignScopeResponse.body.message).toMatch(/outside the current franchise/i);

    const foreignBranchResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-a-cookie"])
      .send({
        baseRevision: autoScopeResponse.body.revision,
        baseUpdatedAt: autoScopeResponse.body.updatedAt,
        workspaceState: {
          sketchWalls: [{ id: "wall-foreign-branch", franchiseId: "franchise-a", branchId: "branch-b" }]
        }
      });
    expect(foreignBranchResponse.status).toBe(403);
    expect(foreignBranchResponse.body.message).toMatch(/branch outside the current franchise/i);

    const ambiguousScopeResponse = await request(app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=multi-franchise-cookie"])
      .send({
        baseRevision: autoScopeResponse.body.revision,
        baseUpdatedAt: autoScopeResponse.body.updatedAt,
        workspaceState: { sketchWalls: [{ id: "wall-ambiguous" }] }
      });
    expect(ambiguousScopeResponse.status).toBe(403);
    expect(ambiguousScopeResponse.body.message).toMatch(/choose one authorized franchise/i);
    const franchiseBAfterRejectedWrite = await request(app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=franchise-b-cookie"]);
    expect(franchiseBAfterRejectedWrite.body.workspaceState.sketchWalls).toEqual([
      expect.objectContaining({ id: "predictable-wall-id", notes: "Franchise B original" })
    ]);
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
    expect(createResponse.body.user.portalCodeHash).toBeUndefined();
    expect(createResponse.body.grant.tokenHash).toBeUndefined();
    expect(createResponse.body.grant.portalCodeHash).toBeUndefined();
    expect(createResponse.body.grant.visibleApplicationIds).toEqual(expect.arrayContaining([
      "general-contracting", "restoration-claims", "communications-intelligence"
    ]));
    expect(createResponse.body.grant.applicationAccess).toEqual(expect.any(Array));
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.users.map((user) => user.email)).toContain("created.worker@example.com");
    expect(listResponse.body.users.every((user) => user.portalCodeHash === undefined)).toBe(true);
    expect(fakeDb.dump("osUsers")["created-worker-uid"].roleId).toBe("worker");
    expect(fakeDb.dump("osUsers")["created-worker-uid"].visibleApplicationIds).toEqual(expect.arrayContaining([
      "general-contracting", "restoration-claims", "communications-intelligence"
    ]));

    const roleUpdateResponse = await request(app)
      .patch("/api/rbac/users/created-worker-uid")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({
        roleId: "contractor",
        visibleTabIds: ["payments"],
        visiblePageIds: ["payments"]
      });
    expect(roleUpdateResponse.status).toBe(200);
    expect(roleUpdateResponse.body.user.visibleApplicationIds).toEqual(["finance-and-reporting"]);
    expect(fakeDb.dump("osAccessGrants")[createResponse.body.grant.id].visibleApplicationIds)
      .toEqual(["finance-and-reporting"]);

    const resetResponse = await request(app)
      .post("/api/rbac/users/created-worker-uid/reset-permissions")
      .set("Cookie", ["brothers_os_session=session-cookie"]);
    expect(resetResponse.status).toBe(200);
    expect(fakeDb.dump("osUsers")["created-worker-uid"].visibleApplicationIds).toEqual(expect.arrayContaining([
      "command-governance", "general-contracting", "finance-and-reporting", "contractor-network", "communications-intelligence"
    ]));
    expect(fakeDb.dump("osAccessGrants")[createResponse.body.grant.id].applicationAccess).toEqual(expect.any(Array));
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

    const blankCompanyPivot = await request(app)
      .patch("/api/rbac/users/franchise-owner-uid")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({ companyId: "   " });
    expect(blankCompanyPivot.status).toBe(400);

    const foreignCompanyPivot = await request(app)
      .patch("/api/rbac/users/franchise-owner-uid")
      .set("Cookie", ["brothers_os_session=session-cookie"])
      .send({ companyId: "other-company" });
    expect(foreignCompanyPivot.status).toBe(403);
    expect(fakeDb.dump("osUsers")["franchise-owner-uid"].companyId).toBe("default-company");

    await fakeDb.collection("osUsers").doc("franchise-owner-uid").set({ companyId: "" }, { merge: true });
    const malformedTenantSession = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=session-cookie"]);
    expect(malformedTenantSession.status).toBe(403);
    expect(malformedTenantSession.body.message).toMatch(/invalid tenant assignment/i);
    expect(fakeDb.dump("osUsers")["franchise-owner-uid"].companyId).toBe("");
  });

  it("isolates company settings, franchise settings, and audit logs by immutable tenant scope", async () => {
    const companyASettingsId = hashSecret("company-a\u0000company-settings").slice(0, 48);
    const companyBSettingsId = hashSecret("company-b\u0000company-settings").slice(0, 48);
    const fakeDb = createFakeFirestore({
      osUsers: {
        "franchise-owner-uid": {
          email: "franchise@example.com",
          displayName: "Franchise Owner",
          roleId: "franchise_owner",
          companyId: "company-a",
          franchiseIds: ["franchise-a"],
          status: "active",
          disabled: false
        },
        "business-owner-uid": {
          email: "business@example.com",
          displayName: "Business Owner",
          roleId: "business_owner",
          companyId: "company-a",
          franchiseIds: ["franchise-a"],
          status: "active",
          disabled: false
        },
        "business-owner-b-uid": {
          email: "business-b@example.com",
          displayName: "Business Owner B",
          roleId: "business_owner",
          companyId: "company-b",
          franchiseIds: ["foreign-franchise"],
          status: "active",
          disabled: false
        }
      },
      osCompanySettings: {
        [companyASettingsId]: { id: companyASettingsId, companyId: "company-a", brandName: "Company A" },
        [companyBSettingsId]: { id: companyBSettingsId, companyId: "company-b", brandName: "Company B" }
      },
      osFranchiseSettings: {
        "franchise-a": { id: "franchise-a", companyId: "company-a", franchiseId: "franchise-a", displayName: "Franchise A" },
        "franchise-b": { id: "franchise-b", companyId: "company-a", franchiseId: "franchise-b", displayName: "Franchise B" },
        "foreign-franchise": { id: "foreign-franchise", companyId: "company-b", franchiseId: "foreign-franchise", displayName: "Foreign Franchise" },
        "legacy-unscoped": { id: "legacy-unscoped", displayName: "Legacy Unscoped" }
      },
      osAuditLogs: {
        "audit-own": { actorUid: "actor-a", companyId: "company-a", franchiseIds: ["franchise-a"], eventType: "own_event", createdAt: "2026-08-04T12:00:00.000Z" },
        "audit-sibling": { actorUid: "actor-b", companyId: "company-a", franchiseIds: ["franchise-b"], eventType: "sibling_event", createdAt: "2026-08-03T12:00:00.000Z" },
        "audit-foreign": { actorUid: "actor-c", companyId: "company-b", franchiseIds: ["foreign-franchise"], eventType: "foreign_event", createdAt: "2026-08-02T12:00:00.000Z" },
        "audit-legacy": { actorUid: "actor-legacy", eventType: "legacy_event", createdAt: "2026-08-01T12:00:00.000Z" }
      },
      osBusinessRecords: {
        "customer-a": { id: "customer-a", type: "customer", companyId: "company-a", franchiseId: "franchise-a", name: "Assigned Customer" },
        "revenue-a": { id: "revenue-a", type: "revenueInvoice", companyId: "company-a", franchiseId: "franchise-a", amount: 1000 },
        "contractor-a": { id: "contractor-a", type: "contractorInvoice", companyId: "company-a", franchiseId: "franchise-a", amount: 400 },
        "customer-b": { id: "customer-b", type: "customer", companyId: "company-a", franchiseId: "franchise-b", name: "Sibling Customer" },
        "revenue-b": { id: "revenue-b", type: "revenueInvoice", companyId: "company-a", franchiseId: "franchise-b", amount: 2000 },
        "foreign-customer": { id: "foreign-customer", type: "customer", companyId: "company-b", franchiseId: "foreign-franchise", name: "Foreign Customer" }
      }
    });
    const identities = {
      "franchise-cookie": freshGoogleIdentity({ uid: "franchise-owner-uid", email: "franchise@example.com", name: "Franchise Owner" }),
      "business-cookie": freshGoogleIdentity({ uid: "business-owner-uid", email: "business@example.com", name: "Business Owner" }),
      "business-b-cookie": freshGoogleIdentity({ uid: "business-owner-b-uid", email: "business-b@example.com", name: "Business Owner B" })
    };
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
          verifySessionCookie: async (cookie) => identities[cookie],
          getUser: async (uid) => ({
            uid,
            email: fakeDb.dump("osUsers")[uid]?.email,
            displayName: fakeDb.dump("osUsers")[uid]?.displayName,
            disabled: false
          }),
          setCustomUserClaims: async () => undefined
        };
      },
      getFirebasePublicConfig: () => ({ enabled: true, adminConfigured: true, webConfigured: true }),
      getFirestore: () => fakeDb,
      isFirebaseConfigured: () => true
    });
    app.use(router);

    const franchiseContext = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=franchise-cookie"]);
    expect(franchiseContext.status).toBe(200);
    expect(franchiseContext.body.franchiseSettings.map((record) => record.id)).toEqual(["franchise-a"]);
    expect(franchiseContext.body.businessData.map((record) => record.id).sort()).toEqual([
      "contractor-a", "customer-a", "revenue-a"
    ]);

    const directFranchiseBusinessData = await request(app)
      .get("/api/business-data")
      .set("Cookie", ["brothers_os_session=franchise-cookie"]);
    expect(directFranchiseBusinessData.status).toBe(200);
    expect(directFranchiseBusinessData.body.businessData.map((record) => record.id).sort())
      .toEqual(["contractor-a", "customer-a", "revenue-a"]);

    const ownUpdate = await request(app)
      .patch("/api/rbac/franchise-settings/franchise-a")
      .set("Cookie", ["brothers_os_session=franchise-cookie"])
      .send({ displayName: "Franchise A Updated" });
    expect(ownUpdate.status).toBe(200);

    const siblingUpdate = await request(app)
      .patch("/api/rbac/franchise-settings/franchise-b")
      .set("Cookie", ["brothers_os_session=franchise-cookie"])
      .send({ displayName: "Forbidden sibling update" });
    expect(siblingUpdate.status).toBe(403);

    const foreignUpdate = await request(app)
      .patch("/api/rbac/franchise-settings/foreign-franchise")
      .set("Cookie", ["brothers_os_session=franchise-cookie"])
      .send({ displayName: "Forbidden foreign update" });
    expect(foreignUpdate.status).toBe(403);

    const scopeMutation = await request(app)
      .patch("/api/rbac/franchise-settings/franchise-a")
      .set("Cookie", ["brothers_os_session=franchise-cookie"])
      .send({ companyId: "company-b", franchiseId: "franchise-b" });
    expect(scopeMutation.status).toBe(400);
    expect(fakeDb.dump("osFranchiseSettings")["franchise-a"]).toMatchObject({
      companyId: "company-a",
      franchiseId: "franchise-a",
      displayName: "Franchise A Updated"
    });

    const stampedAudit = Object.values(fakeDb.dump("osAuditLogs")).find((record) => (
      record.eventType === "osFranchiseSettings_updated" && record.targetId === "franchise-a"
    ));
    expect(stampedAudit).toMatchObject({
      companyId: "company-a",
      franchiseIds: ["franchise-a"],
      tenantScopeVersion: 1
    });

    const businessContext = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=business-cookie"]);
    expect(businessContext.status).toBe(200);
    expect(businessContext.body.franchiseSettings.map((record) => record.id).sort()).toEqual(["franchise-a", "franchise-b"]);
    expect(businessContext.body.businessData.map((record) => record.id).sort()).toEqual([
      "contractor-a", "customer-a", "customer-b", "revenue-a", "revenue-b"
    ]);
    expect(businessContext.body.companySettings).toMatchObject({
      id: companyASettingsId,
      companyId: "company-a",
      brandName: "Company A"
    });

    const companyAUpdate = await request(app)
      .patch("/api/rbac/company-settings/default")
      .set("Cookie", ["brothers_os_session=business-cookie"])
      .send({ brandName: "Company A Updated" });
    expect(companyAUpdate.status).toBe(200);

    const companyScopeMutation = await request(app)
      .patch("/api/rbac/company-settings/default")
      .set("Cookie", ["brothers_os_session=business-cookie"])
      .send({ companyId: "company-b", brandName: "Cross-tenant write" });
    expect(companyScopeMutation.status).toBe(400);

    const companyBContext = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=business-b-cookie"]);
    expect(companyBContext.status).toBe(200);
    expect(companyBContext.body.companySettings).toMatchObject({
      id: companyBSettingsId,
      companyId: "company-b",
      brandName: "Company B"
    });
    expect(fakeDb.dump("osCompanySettings")[companyASettingsId]).toMatchObject({
      companyId: "company-a",
      brandName: "Company A Updated"
    });
    expect(fakeDb.dump("osCompanySettings")[companyBSettingsId]).toMatchObject({
      companyId: "company-b",
      brandName: "Company B"
    });
    const companyAContextAfterUpdate = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=business-cookie"]);
    expect(companyAContextAfterUpdate.body.companySettings.brandName).toBe("Company A Updated");
    expect(companyAContextAfterUpdate.body.auditLogs.map((record) => record.eventType)).toEqual(expect.arrayContaining([
      "own_event", "osFranchiseSettings_updated", "osCompanySettings_updated"
    ]));
    expect(companyAContextAfterUpdate.body.auditLogs.map((record) => record.eventType)).not.toEqual(expect.arrayContaining([
      "sibling_event", "foreign_event", "legacy_event"
    ]));

    const directAudit = await request(app)
      .get("/api/rbac/audit-logs")
      .set("Cookie", ["brothers_os_session=business-cookie"]);
    expect(directAudit.status).toBe(200);
    expect(directAudit.body.auditLogs.map((record) => record.eventType)).toEqual(
      companyAContextAfterUpdate.body.auditLogs.map((record) => record.eventType)
    );
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

      expect(payload.insuranceIntake.adminConfigured).toBe(true);
      expect(payload.insuranceIntake.adminAuthMode).toBe("firebase-google");
      expect(payload.insuranceIntake.legacyAdminLoginEnabled).toBe(false);
      expect(payload.insuranceIntake.adminEmailsConfigured).toBe(1);
      expect(payload.insuranceIntake.allowedOrigin).toBe("https://www.brothersrestoration.org");
      expect(payload.insuranceIntake.allowedOriginConfigured).toBe(true);
      expect(payload.insuranceIntake.osBaseUrlConfigured).toBe(true);
      expect(payload.insuranceIntake.osBaseUrl).toBe("https://brothers.ad");
      expect(payload.insuranceIntake.legacyProxyMode).toBe(false);
      expect(payload.insuranceIntake.warnings).not.toContain(
        "ALLOWED_WEBSITE_ORIGIN is still using the placeholder domain."
      );
      expect(payload.insuranceIntake.warnings).not.toContain(
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
