import crypto from "crypto";
import { createRequire } from "module";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const require = createRequire(import.meta.url);
const express = require("express");
const { createFirebaseRbacRouter } = require("../lib/firebase-rbac-routes");

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
  let beforeNextTransaction = null;
  const snap = (id, data) => ({ id, exists: Boolean(data), data: () => data });
  const querySnap = (docs) => ({ docs, empty: docs.length === 0 });
  const docsFromCollection = (collectionMap) => Array.from(collectionMap.entries())
    .map(([id, data]) => snap(id, data));
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
        const beforeTransaction = beforeNextTransaction;
        beforeNextTransaction = null;
        if (beforeTransaction) await beforeTransaction();
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
    setBeforeNextTransaction(callback) {
      beforeNextTransaction = callback;
    },
    dump(collectionName) {
      return Object.fromEntries(ensureCollection(collectionName).entries());
    }
  };
}

function googleIdentity(uid, email, name) {
  const now = Math.floor(Date.now() / 1000);
  return {
    uid,
    email,
    email_verified: true,
    name,
    auth_time: now,
    iat: now - 2,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com" }
  };
}

function createEmployeeTestApp() {
  const contractorIdentity = googleIdentity("contractor-uid", "contractor@example.com", "Contractor");
  const otherContractorIdentity = googleIdentity("other-contractor-uid", "other.contractor@example.com", "Other Contractor");
  const workerIdentity = googleIdentity("worker-uid", "employee@example.com", "Google Account Name");
  let sessionIdentity = contractorIdentity;
  const fakeDb = createFakeFirestore({
    osUsers: {
      "contractor-uid": {
        email: contractorIdentity.email,
        displayName: contractorIdentity.name,
        roleId: "contractor",
        companyId: "default-company",
        franchiseIds: ["default-franchise"],
        contractorId: "contractor-alpha",
        status: "active",
        disabled: false,
        portalCodeHash: crypto.createHash("sha256").update("CONTRACTORCODE").digest("hex")
      },
      "other-contractor-uid": {
        email: otherContractorIdentity.email,
        displayName: otherContractorIdentity.name,
        roleId: "contractor",
        companyId: "default-company",
        franchiseIds: ["default-franchise"],
        contractorId: "contractor-beta",
        status: "active",
        disabled: false,
        portalCodeHash: crypto.createHash("sha256").update("OTHERCODE").digest("hex")
      }
    },
    osWorkspaceRecords: {
      "job-9001": {
        companyId: "default-company",
        field: "jobBoards",
        recordId: "J-9001",
        data: {
          id: "JOB-9001",
          jobId: "J-9001",
          contractorId: "contractor-alpha",
          title: "Assigned job one",
          gates: [
            { id: "authorization", label: "Signed authorization", status: "Open" },
            { id: "photos", label: "Required photos", status: "Open" },
            { id: "invoice", label: "Invoice ready", status: "Open" }
          ]
        },
        sortIndex: 0,
        deletedAt: ""
      },
      "job-9002": {
        companyId: "default-company",
        field: "jobBoards",
        recordId: "J-9002",
        data: { id: "JOB-9002", jobId: "J-9002", contractorId: "contractor-alpha", title: "Assigned job two" },
        sortIndex: 1,
        deletedAt: ""
      },
      "job-9003": {
        companyId: "default-company",
        field: "jobBoards",
        recordId: "J-9003",
        data: { id: "JOB-9003", jobId: "J-9003", contractorId: "contractor-alpha", title: "Assigned job three" },
        sortIndex: 2,
        deletedAt: ""
      },
      "job-other": {
        companyId: "default-company",
        field: "jobBoards",
        recordId: "J-OTHER",
        data: { id: "JOB-OTHER", jobId: "J-OTHER", contractorId: "contractor-beta", title: "Other contractor job" },
        sortIndex: 3,
        deletedAt: ""
      },
      "task-document": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-EMP-1",
        data: {
          id: "TASK-EMP-1",
          title: "Document final room condition",
          moduleKey: "jobs",
          relatedJob: "J-9001",
          contractorId: "contractor-alpha",
          assigneeId: "worker-uid",
          assigneeEmail: "employee@example.com",
          status: "Open"
        },
        sortIndex: 0,
        deletedAt: ""
      },
      "task-document-2": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-EMP-2",
        data: {
          id: "TASK-EMP-2",
          title: "Second assigned ticket",
          moduleKey: "photos",
          relatedJob: "J-9002",
          contractorId: "contractor-alpha",
          status: "Open"
        },
        sortIndex: 1,
        deletedAt: ""
      },
      "task-document-3": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-EMP-3",
        data: {
          id: "TASK-EMP-3",
          title: "Third assigned ticket",
          relatedJob: "J-9003",
          contractorId: "contractor-alpha",
          status: "Open"
        },
        sortIndex: 2,
        deletedAt: ""
      },
      "other-task-document": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-OTHER-1",
        data: {
          id: "TASK-OTHER-1",
          title: "Other employee ticket",
          moduleKey: "jobs",
          relatedJob: "J-OTHER",
          contractorId: "contractor-beta",
          assigneeId: "other-worker-uid",
          assigneeEmail: "other.employee@example.com",
          status: "Open"
        },
        sortIndex: 3,
        deletedAt: ""
      },
      "time-worker": {
        companyId: "default-company",
        field: "timeEntries",
        recordId: "TIME-WORKER",
        data: {
          id: "TIME-WORKER",
          job: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "worker-uid",
          workerEmail: "employee@example.com",
          startGps: { latitude: 42.45, longitude: -73.24 }
        },
        sortIndex: 0,
        deletedAt: ""
      },
      "time-sibling": {
        companyId: "default-company",
        field: "timeEntries",
        recordId: "TIME-SIBLING",
        data: {
          id: "TIME-SIBLING",
          job: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "sibling-worker-uid",
          workerEmail: "sibling.employee@example.com",
          startGps: { latitude: 42.5, longitude: -73.3 }
        },
        sortIndex: 1,
        deletedAt: ""
      },
      "file-time-worker": {
        companyId: "default-company",
        field: "files",
        recordId: "FILE-TIME-WORKER",
        data: {
          id: "FILE-TIME-WORKER",
          sourceType: "timeEntry",
          relatedJob: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "worker-uid",
          workerEmail: "employee@example.com",
          notes: "Start GPS: 42.4500, -73.2400"
        },
        sortIndex: 0,
        deletedAt: ""
      },
      "file-time-sibling": {
        companyId: "default-company",
        field: "files",
        recordId: "FILE-TIME-SIBLING",
        data: {
          id: "FILE-TIME-SIBLING",
          sourceType: "timeEntry",
          relatedJob: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "sibling-worker-uid",
          workerEmail: "sibling.employee@example.com",
          notes: "Start GPS: 42.5000, -73.3000"
        },
        sortIndex: 1,
        deletedAt: ""
      },
      "file-task-assignment": {
        companyId: "default-company",
        field: "files",
        recordId: "FILE-TASK-ASSIGNMENT",
        data: {
          id: "FILE-TASK-ASSIGNMENT",
          sourceType: "taskAssignment",
          sourceId: "TASK-EMP-1",
          taskId: "TASK-EMP-1",
          relatedJob: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "worker-uid",
          workerEmail: "employee@example.com",
          title: "Assigned task file",
          status: "Open"
        },
        sortIndex: 2,
        deletedAt: ""
      }
    }
  });
  const authUsers = new Map([
    ["contractor-uid", {
      uid: "contractor-uid",
      email: contractorIdentity.email,
      displayName: contractorIdentity.name,
      disabled: false
    }],
    ["other-contractor-uid", {
      uid: "other-contractor-uid",
      email: otherContractorIdentity.email,
      displayName: otherContractorIdentity.name,
      disabled: false
    }],
    ["worker-uid", {
      uid: "worker-uid",
      email: workerIdentity.email,
      displayName: workerIdentity.name,
      disabled: false
    }]
  ]);
  const auth = {
    verifySessionCookie: async () => sessionIdentity,
    verifyIdToken: async () => workerIdentity,
    getUser: async (uid) => authUsers.get(uid),
    setCustomUserClaims: async () => undefined,
    updateUser: async (uid, updates) => {
      const user = { ...authUsers.get(uid), ...updates };
      authUsers.set(uid, user);
      return user;
    },
    createSessionCookie: async () => "created-session-cookie",
    revokeRefreshTokens: async () => undefined
  };
  const storageObjects = new Map();
  const storageBucket = {
    file(objectPath) {
      return {
        save: async (buffer, options = {}) => {
          storageObjects.set(objectPath, { buffer: Buffer.from(buffer), options });
        },
        download: async () => {
          const stored = storageObjects.get(objectPath);
          if (!stored) throw new Error("Object not found");
          return [Buffer.from(stored.buffer)];
        }
      };
    }
  };
  const app = express();
  app.use(express.json());
  const { router } = createFirebaseRbacRouter({
    express,
    parseCookies(headerValue = "") {
      return Object.fromEntries(
        String(headerValue)
          .split(";")
          .map((part) => part.trim().split("="))
          .filter((parts) => parts.length === 2)
      );
    },
    jsonError(response, statusCode, message) {
      return response.status(statusCode).json({ success: false, message });
    },
    getFirebaseAuth: () => auth,
    getFirebasePublicConfig: () => ({
      enabled: true,
      adminConfigured: true,
      webConfigured: true
    }),
    getFirebaseStorageBucket: () => storageBucket,
    getFirestore: () => fakeDb,
    isFirebaseConfigured: () => true
  });
  app.use(router);
  return {
    app,
    fakeDb,
    setSessionIdentity(identity) {
      sessionIdentity = identity;
    },
    contractorIdentity,
    otherContractorIdentity,
    authUsers,
    storageObjects,
    workerIdentity
  };
}

async function seedActiveWorker(fixture, overrides = {}) {
  const worker = {
    email: fixture.workerIdentity.email,
    displayName: "Employee Name",
    roleId: "worker",
    companyId: "default-company",
    franchiseIds: ["default-franchise"],
    contractorId: "contractor-alpha",
    employerUid: "contractor-uid",
    employerEmail: "contractor@example.com",
    employerContractorId: "contractor-alpha",
    onboardingMode: "employee_link",
    accessScope: "employee_portal",
    employmentStatus: "active",
    visibleTabIds: ["jobs", "photos", "time"],
    visiblePageIds: ["jobs", "photos", "time"],
    assignedJobIds: ["J-9001", "J-9002"],
    assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
    status: "active",
    disabled: false,
    ...overrides
  };
  await fixture.fakeDb.collection("osUsers").doc("worker-uid").set(worker);
  fixture.setSessionIdentity(fixture.workerIdentity);
  return worker;
}

function findActiveWorkspaceRecord(fakeDb, field, recordId) {
  return Object.values(fakeDb.dump("osWorkspaceRecords")).find((record) => (
    record.field === field
    && record.recordId === recordId
    && !record.deletedAt
  ));
}

function signoffEvidenceValues(signoff = {}) {
  const entries = [
    ...(Array.isArray(signoff.photoEvidence) ? signoff.photoEvidence : []),
    ...(Array.isArray(signoff.photoEvidenceAssets) ? signoff.photoEvidenceAssets : []),
    ...(Array.isArray(signoff.evidenceAssets) ? signoff.evidenceAssets : [])
  ];
  return {
    assetIds: [
      ...(Array.isArray(signoff.photoEvidenceAssetIds) ? signoff.photoEvidenceAssetIds : []),
      ...(Array.isArray(signoff.evidenceAssetIds) ? signoff.evidenceAssetIds : []),
      ...entries.map((entry) => entry?.assetId || entry?.id)
    ].filter(Boolean),
    digests: [
      ...(Array.isArray(signoff.photoEvidenceDigests) ? signoff.photoEvidenceDigests : []),
      ...entries.map((entry) => entry?.contentSha256 || entry?.sha256 || entry?.digest || entry?.contentDigest)
    ].filter(Boolean)
  };
}

async function seedPhotoTicketEvidence(fixture, {
  assetId = "asset-task-2",
  digest = crypto.createHash("sha256").update("task-2-photo-bytes").digest("hex")
} = {}) {
  await fixture.fakeDb.collection("osWorkspaceRecords").doc("photo-task-2-security").set({
    companyId: "default-company",
    field: "photoRecords",
    recordId: "PHOTO-TASK-2-SECURITY",
    data: {
      id: "PHOTO-TASK-2-SECURITY",
      taskId: "TASK-EMP-2",
      jobId: "J-9002",
      contractorId: "contractor-alpha",
      workerId: "worker-uid",
      workerEmail: "employee@example.com",
      assetId
    },
    sortIndex: 0,
    deletedAt: ""
  });
  await fixture.fakeDb.collection("osWorkspaceAssets").doc(assetId).set({
    id: assetId,
    companyId: "default-company",
    taskId: "TASK-EMP-2",
    jobId: "J-9002",
    contractorId: "contractor-alpha",
    workerId: "worker-uid",
    workerEmail: "employee@example.com",
    createdByUid: "worker-uid",
    createdByEmail: "employee@example.com",
    objectPath: `os-workspace/default-company/${assetId}.jpg`,
    contentType: "image/jpeg",
    detectedContentType: "image/jpeg",
    contentVerified: true,
    contentSha256: digest
  });
  return { assetId, digest };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
  delete process.env.INVITE_FROM_EMAIL;
});

describe("employee portal onboarding and ticket sign-off", () => {
  it("binds a contractor-issued invitation to that contractor and accepts the exact Google email without a portal code", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Invited Employee Name",
        email: "employee@example.com",
        employmentType: "Seasonal employee",
        startDate: "2026-09-01",
        contractorId: "contractor-other",
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["time", "jobs", "payments"],
        sendEmail: false
      });

    expect(invitation.status).toBe(201);
    expect(invitation.body.accessCode).toBeUndefined();
    expect(invitation.body.accessLink).toMatch(/^https:\/\/www\.brothers\.ad\/\?portal=employee#access\//);
    expect(invitation.body.grant).toMatchObject({
      roleId: "worker",
      contractorId: "contractor-alpha",
      employerUid: "contractor-uid",
      employerEmail: "contractor@example.com",
      employerContractorId: "contractor-alpha",
      onboardingMode: "employee_link",
      employmentType: "Seasonal employee",
      startDate: "2026-09-01",
      assignedTaskIds: ["TASK-EMP-1"],
      visiblePageIds: ["time", "jobs"]
    });
    expect(invitation.body.grant.tokenHash).toBeUndefined();

    const pendingContext = await request(fixture.app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    expect(pendingContext.status).toBe(200);
    expect(pendingContext.body.users.map((user) => user.email)).not.toContain("employee@example.com");
    expect(pendingContext.body.accessGrants).toContainEqual(expect.objectContaining({
      id: invitation.body.grant.id,
      email: "employee@example.com",
      displayName: "Invited Employee Name",
      employmentType: "Seasonal employee",
      startDate: "2026-09-01",
      status: "issued",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha"
    }));

    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const crossEmployerGrantUpdate = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=other-contractor-session"])
      .send({ assignedTaskIds: ["TASK-OTHER-1"] });
    expect(crossEmployerGrantUpdate.status).toBe(403);

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const bindingChange = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ contractorId: "contractor-beta" });
    expect(bindingChange.status).toBe(400);

    const disallowedModuleUpdate = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ visibleModuleKeys: ["payments"] });
    expect(disallowedModuleUpdate.status).toBe(400);

    const emptyModuleUpdate = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ visibleModuleKeys: [] });
    expect(emptyModuleUpdate.status).toBe(400);
    expect(emptyModuleUpdate.body.message).toMatch(/select at least one module/i);

    const pendingUpdate = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Assigned Before Acceptance",
        phone: "555-010-1010",
        jobTitle: "Lead Technician",
        employmentType: "Part-time employee",
        startDate: "2026-09-15",
        assignedJobIds: ["J-9001", "J-9002"],
        assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
        visibleModuleKeys: ["jobs", "photos", "time"]
      });
    expect(pendingUpdate.status).toBe(200);
    expect(pendingUpdate.body.grant).toMatchObject({
      displayName: "Assigned Before Acceptance",
      phone: "555-010-1010",
      jobTitle: "Lead Technician",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      assignedJobIds: ["J-9001", "J-9002"],
      assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
      visibleTabIds: ["jobs", "photos", "time"],
      visiblePageIds: ["jobs", "photos", "time"],
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha"
    });
    expect(pendingUpdate.body.grant.tokenHash).toBeUndefined();

    const pendingAssignmentOnly = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2", "TASK-EMP-3"] });
    expect(pendingAssignmentOnly.status).toBe(403);
    expect(pendingAssignmentOnly.body.message).toMatch(/missing module/i);

    const updatedPendingContext = await request(fixture.app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    expect(updatedPendingContext.body.accessGrants).toContainEqual(expect.objectContaining({
      id: invitation.body.grant.id,
      displayName: "Assigned Before Acceptance",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
      visiblePageIds: ["jobs", "photos", "time"]
    }));

    const accessToken = decodeURIComponent(new URL(invitation.body.accessLink).hash.replace("#access/", ""));
    const login = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });

    expect(login.status).toBe(200);
    expect(login.body.session).toMatchObject({
      uid: "worker-uid",
      email: "employee@example.com",
      roleId: "worker",
      contractorId: "contractor-alpha",
      accessScope: "employee_portal",
      accessExpiresAt: ""
    });
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"]).toMatchObject({
      displayName: "Assigned Before Acceptance",
      roleId: "worker",
      employerUid: "contractor-uid",
      employerEmail: "contractor@example.com",
      employerContractorId: "contractor-alpha",
      employmentStatus: "active",
      accessExpiresAt: "",
      phone: "555-010-1010",
      jobTitle: "Lead Technician",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      assignedJobIds: ["J-9001", "J-9002"],
      assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
      visiblePageIds: ["jobs", "photos", "time"]
    });
    expect(fixture.authUsers.get("worker-uid").displayName).toBe("Assigned Before Acceptance");

    const assignmentUpdate = await request(fixture.app)
      .patch("/api/employees/worker-uid/assignments")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ assignedJobIds: ["J-9001", "J-9003"] });
    expect(assignmentUpdate.status).toBe(200);
    expect(assignmentUpdate.body.user.assignedTaskIds).toEqual(["TASK-EMP-1", "TASK-EMP-2"]);

    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const crossEmployerUpdate = await request(fixture.app)
      .patch("/api/employees/worker-uid/assignments")
      .set("Cookie", ["brothers_os_session=other-contractor-session"])
      .send({ assignedTaskIds: ["TASK-OTHER-1"] });
    expect(crossEmployerUpdate.status).toBe(403);

    fixture.setSessionIdentity(fixture.workerIdentity);
    await Promise.all([
      fixture.fakeDb.collection("osWorkspaceRecords").doc("drylog-hidden").set({
        companyId: "default-company",
        field: "dryLogs",
        recordId: "DRY-HIDDEN",
        data: { id: "DRY-HIDDEN", job: "J-9001", contractorId: "contractor-alpha", workerId: "worker-uid" },
        sortIndex: 0,
        deletedAt: ""
      }),
      fixture.fakeDb.collection("osWorkspaceRecords").doc("equipment-hidden").set({
        companyId: "default-company",
        field: "equipmentDeployments",
        recordId: "EQ-HIDDEN",
        data: { id: "EQ-HIDDEN", job: "J-9001", contractorId: "contractor-alpha", workerId: "worker-uid" },
        sortIndex: 0,
        deletedAt: ""
      }),
      fixture.fakeDb.collection("osWorkspaceRecords").doc("service-hidden").set({
        companyId: "default-company",
        field: "serviceRequests",
        recordId: "SERVICE-HIDDEN",
        data: { id: "SERVICE-HIDDEN", jobId: "J-9001", contractorId: "contractor-alpha", workerId: "worker-uid" },
        sortIndex: 0,
        deletedAt: ""
      }),
      fixture.fakeDb.collection("osWorkspaceRecords").doc("file-equipment-hidden").set({
        companyId: "default-company",
        field: "files",
        recordId: "FILE-EQUIPMENT-HIDDEN",
        data: {
          id: "FILE-EQUIPMENT-HIDDEN",
          sourceType: "equipmentDeployment",
          relatedJob: "J-9001",
          contractorId: "contractor-alpha",
          workerId: "worker-uid",
          workerEmail: "employee@example.com"
        },
        sortIndex: 3,
        deletedAt: ""
      }),
      fixture.fakeDb.collection("osWorkspaceRecords").doc("clock-worker").set({
        companyId: "default-company",
        field: "activeClockSessions",
        recordId: "CLOCK-WORKER",
        data: {
          id: "CLOCK-WORKER",
          job: "J-9001",
          taskId: "TASK-EMP-1",
          workerId: "worker-uid",
          workerEmail: "employee@example.com",
          contractorId: "contractor-alpha",
          start: "2026-08-24T12:00:00.000Z",
          startGps: { latitude: 42.45, longitude: -73.24, accuracy: 8 }
        },
        sortIndex: 0,
        deletedAt: ""
      }),
      fixture.fakeDb.collection("osWorkspaceRecords").doc("clock-sibling").set({
        companyId: "default-company",
        field: "activeClockSessions",
        recordId: "CLOCK-SIBLING",
        data: {
          id: "CLOCK-SIBLING",
          job: "J-9001",
          workerId: "sibling-worker-uid",
          workerEmail: "sibling.employee@example.com",
          contractorId: "contractor-alpha",
          start: "2026-08-24T12:00:00.000Z",
          startGps: { latitude: 42.5, longitude: -73.3, accuracy: 9 }
        },
        sortIndex: 1,
        deletedAt: ""
      })
    ]);
    const workerWorkspace = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    expect(workerWorkspace.status).toBe(200);
    expect(workerWorkspace.body.workspaceState.tasks.map((task) => task.id)).toEqual(["TASK-EMP-1", "TASK-EMP-2"]);
    expect(workerWorkspace.body.workspaceState.jobBoards.map((job) => job.jobId)).toEqual(["J-9001", "J-9003"]);
    expect(workerWorkspace.body.workspaceState.timeEntries.map((entry) => entry.id)).toEqual(["TIME-WORKER"]);
    expect(workerWorkspace.body.workspaceState.files.map((file) => file.id)).toEqual(["FILE-TIME-WORKER", "FILE-TASK-ASSIGNMENT"]);
    expect(workerWorkspace.body.workspaceState.activeClockSessions.map((entry) => entry.id)).toEqual(["CLOCK-WORKER"]);
    expect(workerWorkspace.body.workspaceState.dryLogs || []).toEqual([]);
    expect(workerWorkspace.body.workspaceState.equipmentDeployments || []).toEqual([]);
    expect(workerWorkspace.body.workspaceState.serviceRequests || []).toEqual([]);

    const hiddenModuleSignoff = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-3",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(hiddenModuleSignoff.status).toBe(404);
    expect(hiddenModuleSignoff.body.message).toMatch(/could not be found/i);

    const completionBypass = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: workerWorkspace.body.revision,
        baseUpdatedAt: workerWorkspace.body.updatedAt,
        workspaceState: {
          tasks: [{
            ...workerWorkspace.body.workspaceState.tasks[0],
            status: "Complete",
            completedAt: "2026-08-24T12:00:00.000Z",
            completedByEmail: "employee@example.com",
            photoEvidenceIds: ["PHOTO-LINKED"],
            photoEvidenceAt: "2026-08-24T12:00:00.000Z"
          }]
        }
    });
    expect(completionBypass.status).toBe(200);
    const activeTask = findActiveWorkspaceRecord(fixture.fakeDb, "tasks", "TASK-EMP-1");
    expect(activeTask?.data).toMatchObject({
      status: "Open",
      photoEvidenceIds: ["PHOTO-LINKED"],
      photoEvidenceAt: "2026-08-24T12:00:00.000Z"
    });
    expect(activeTask?.data.completedAt).toBeUndefined();

    const assignmentFileBypass = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: completionBypass.body.revision,
        baseUpdatedAt: completionBypass.body.updatedAt,
        workspaceState: {
          files: [{
            ...workerWorkspace.body.workspaceState.files.find((file) => file.id === "FILE-TASK-ASSIGNMENT"),
            status: "Complete"
          }]
        }
      });
    expect(assignmentFileBypass.status).toBe(200);
    expect(findActiveWorkspaceRecord(fixture.fakeDb, "files", "FILE-TASK-ASSIGNMENT")?.data.status).toBe("Open");

    const gateBypass = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: assignmentFileBypass.body.revision,
        baseUpdatedAt: assignmentFileBypass.body.updatedAt,
        workspaceState: {
          jobBoards: [{
            ...workerWorkspace.body.workspaceState.jobBoards.find((job) => job.jobId === "J-9001"),
            gates: [
              { id: "authorization", label: "Signed authorization", status: "Done" },
              { id: "photos", label: "Required photos", status: "Done" },
              { id: "invoice", label: "Invoice ready", status: "Done" },
              { id: " Deposit ", label: "Deposit / deductible", status: "Done" }
            ]
          }]
        }
      });
    expect(gateBypass.status).toBe(200);
    expect(findActiveWorkspaceRecord(fixture.fakeDb, "jobBoards", "JOB-9001")?.data.gates).toEqual([
      expect.objectContaining({ id: "authorization", status: "Open" }),
      expect.objectContaining({ id: "photos", status: "Done" }),
      expect.objectContaining({ id: "invoice", status: "Open" })
    ]);

    const concurrentWrites = await Promise.all([
      request(fixture.app)
        .put("/api/workspace-state")
        .set("Cookie", ["brothers_os_session=worker-session"])
        .send({
          baseRevision: gateBypass.body.revision,
          baseUpdatedAt: gateBypass.body.updatedAt,
          workspaceState: {
            photoRecords: [{ id: "PHOTO-CONCURRENT-A", taskId: "TASK-EMP-1", jobId: "J-9001", assetId: "asset-a" }]
          }
        }),
      request(fixture.app)
        .put("/api/workspace-state")
        .set("Cookie", ["brothers_os_session=worker-session"])
        .send({
          baseRevision: gateBypass.body.revision,
          baseUpdatedAt: gateBypass.body.updatedAt,
          workspaceState: {
            photoRecords: [{ id: "PHOTO-CONCURRENT-B", taskId: "TASK-EMP-1", jobId: "J-9001", assetId: "asset-b" }]
          }
        })
    ]);
    expect(concurrentWrites.map((response) => response.status).sort()).toEqual([200, 409]);
    const concurrentWinner = concurrentWrites.find((response) => response.status === 200);

    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const otherContractorWrite = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=other-contractor-session"])
      .send({
        baseRevision: concurrentWinner.body.revision,
        baseUpdatedAt: concurrentWinner.body.updatedAt,
        workspaceState: {
          files: [{ id: "FILE-OTHER-CONTRACTOR", relatedJob: "J-OTHER", title: "Other contractor file" }]
        }
      });
    expect(otherContractorWrite.status).toBe(200);

    fixture.setSessionIdentity(fixture.workerIdentity);
    const workerReloadAfterOtherWrite = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    expect(workerReloadAfterOtherWrite.body.revision).toBe(otherContractorWrite.body.revision);
    expect(workerReloadAfterOtherWrite.body.workspaceState.files.map((file) => file.id)).not.toContain("FILE-OTHER-CONTRACTOR");
    const workerSaveAfterOtherWrite = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: workerReloadAfterOtherWrite.body.revision,
        baseUpdatedAt: workerReloadAfterOtherWrite.body.updatedAt,
        workspaceState: {
          tasks: [workerReloadAfterOtherWrite.body.workspaceState.tasks[0]]
        }
      });
    expect(workerSaveAfterOtherWrite.status).toBe(200);

    const foreignFranchiseWrite = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: workerSaveAfterOtherWrite.body.revision,
        baseUpdatedAt: workerSaveAfterOtherWrite.body.updatedAt,
        workspaceState: {
          photoRecords: [{
            id: "PHOTO-FOREIGN",
            taskId: "TASK-EMP-1",
            jobId: "J-9001",
            franchiseId: "foreign-franchise",
            assetId: "asset-foreign"
          }]
        }
      });
    expect(foreignFranchiseWrite.status).toBe(403);

    const staleReplay = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: completionBypass.body.revision,
        baseUpdatedAt: completionBypass.body.updatedAt,
        workspaceState: {
          tasks: [{ ...workerWorkspace.body.workspaceState.tasks[0], title: "Stale title" }]
        }
      });
    expect(staleReplay.status).toBe(409);

    const selfBindingChange = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ employerUid: "other-contractor-uid", contractorId: "contractor-beta" });
    expect(selfBindingChange.status).toBe(400);

    const profileUpdate = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        displayName: "Employee Preferred Name",
        phone: " 555-010-2020 "
      });
    expect(profileUpdate.status).toBe(200);
    expect(profileUpdate.body.user).toMatchObject({
      displayName: "Employee Preferred Name",
      phone: "555-010-2020",
      jobTitle: "Lead Technician",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha"
    });
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"]).toMatchObject({
      displayName: "Employee Preferred Name",
      phone: "555-010-2020",
      jobTitle: "Lead Technician",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha"
    });
    expect(fixture.authUsers.get("worker-uid").displayName).toBe("Employee Preferred Name");

    const titleUpdate = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ jobTitle: "Crew Lead" });
    expect(titleUpdate.status).toBe(200);
    expect(titleUpdate.body.user).toMatchObject({
      displayName: "Employee Preferred Name",
      phone: "555-010-2020",
      jobTitle: "Crew Lead",
      employmentType: "Part-time employee",
      startDate: "2026-09-15"
    });

    const startDateUpdate = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ startDate: "2026-10-01" });
    expect(startDateUpdate.status).toBe(400);
    const employmentTypeUpdate = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ employmentType: "Employee" });
    expect(employmentTypeUpdate.status).toBe(400);

    const returningLogin = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token" });
    expect(returningLogin.status).toBe(200);
    expect(returningLogin.body.session).toMatchObject({
      uid: "worker-uid",
      roleId: "worker",
      contractorId: "contractor-alpha",
      accessScope: "employee_portal"
    });
    const returningContext = await request(fixture.app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    expect(returningContext.status).toBe(200);
    expect(returningContext.body.user).toMatchObject({
      displayName: "Employee Preferred Name",
      phone: "555-010-2020",
      jobTitle: "Crew Lead",
      employmentType: "Part-time employee",
      startDate: "2026-09-15",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha"
    });

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const acceptedGrantUpdate = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ assignedTaskIds: ["TASK-OTHER-1"] });
    expect(acceptedGrantUpdate.status).toBe(409);

    const reusedLink = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });
    expect(reusedLink.status).toBe(403);
  });

  it("lets only the bound employer revoke a pending employee invitation", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ displayName: "Pending Employee", email: "employee@example.com", sendEmail: false });
    expect(invitation.status).toBe(201);

    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const crossEmployerRevoke = await request(fixture.app)
      .delete(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=other-contractor-session"]);
    expect(crossEmployerRevoke.status).toBe(403);

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const revoke = await request(fixture.app)
      .delete(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    expect(revoke.status).toBe(200);
    expect(revoke.body.grant).toMatchObject({ status: "revoked", email: "employee@example.com" });
    expect(revoke.body.grant.tokenHash).toBeUndefined();
    expect(fixture.fakeDb.dump("osAccessGrants")[invitation.body.grant.id]).toMatchObject({
      status: "revoked",
      tokenHash: ""
    });
  });

  it("requires a real employee name before issuing an employer-bound invitation", async () => {
    const fixture = createEmployeeTestApp();
    const response = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ email: "employee@example.com", displayName: "   ", sendEmail: false });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/employee name/i);
    expect(Object.keys(fixture.fakeDb.dump("osAccessGrants"))).toHaveLength(0);
  });

  it("rejects unsupported employment types and invalid employee start dates", async () => {
    const fixture = createEmployeeTestApp();
    const invalidType = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        email: "employee@example.com",
        displayName: "Employee",
        employmentType: "Temporary mystery role",
        startDate: "2026-09-01",
        sendEmail: false
      });
    expect(invalidType.status).toBe(400);
    expect(invalidType.body.message).toMatch(/employment type/i);

    const invalidDate = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        email: "employee@example.com",
        displayName: "Employee",
        employmentType: "Employee",
        startDate: "2026-02-30",
        sendEmail: false
      });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.message).toMatch(/start date/i);
    expect(Object.keys(fixture.fakeDb.dump("osAccessGrants"))).toHaveLength(0);
  });

  it("rejects employee assignments outside the inviter's contractor scope", async () => {
    const fixture = createEmployeeTestApp();
    const response = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Out of scope employee",
        email: "employee@example.com",
        assignedJobIds: ["J-OTHER"],
        assignedTaskIds: ["TASK-OTHER-1"],
        sendEmail: false
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/current contractor workspace/i);
    expect(Object.keys(fixture.fakeDb.dump("osAccessGrants"))).toHaveLength(0);
  });

  it("requires the invitation to remain bound to the inviter's current company", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ displayName: "Pending Employee", email: "employee@example.com", sendEmail: false });
    expect(invitation.status).toBe(201);
    await fixture.fakeDb.collection("osAccessGrants").doc(invitation.body.grant.id).set({
      companyId: "another-company"
    }, { merge: true });

    const update = await request(fixture.app)
      .patch(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ phone: "555-000-1234" });
    const revoke = await request(fixture.app)
      .delete(`/api/employee-invitations/${invitation.body.grant.id}`)
      .set("Cookie", ["brothers_os_session=contractor-session"]);

    expect(update.status).toBe(403);
    expect(revoke.status).toBe(403);
    expect(fixture.fakeDb.dump("osAccessGrants")[invitation.body.grant.id].status).toBe("issued");
  });

  it("does not let an inactive employee reactivate through a profile edit", async () => {
    const fixture = createEmployeeTestApp();
    await fixture.fakeDb.collection("osUsers").doc("worker-uid").set({
      email: "employee@example.com",
      displayName: "Inactive Employee",
      roleId: "worker",
      companyId: "default-company",
      franchiseIds: ["default-franchise"],
      contractorId: "contractor-alpha",
      employerUid: "contractor-uid",
      employerEmail: "contractor@example.com",
      employerContractorId: "contractor-alpha",
      accessScope: "employee_portal",
      employmentStatus: "inactive",
      status: "active",
      disabled: false
    });
    fixture.setSessionIdentity(fixture.workerIdentity);

    const sessionResponse = await request(fixture.app)
      .get("/api/auth/session")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    expect(sessionResponse.status).toBe(403);
    expect(sessionResponse.body.message).toMatch(/inactive/i);

    const response = await request(fixture.app)
      .patch("/api/employee/profile")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ phone: "555-555-5555" });

    expect(response.status).toBe(403);
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"].employmentStatus).toBe("inactive");
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"].phone).not.toBe("555-555-5555");
  });

  it("denies employee invitation privileges to workers", async () => {
    const fixture = createEmployeeTestApp();
    await fixture.fakeDb.collection("osUsers").doc("worker-uid").set({
      email: "employee@example.com",
      displayName: "Employee",
      roleId: "worker",
      companyId: "default-company",
      franchiseIds: ["default-franchise"],
      contractorId: "contractor-alpha",
      status: "active",
      disabled: false
    });
    fixture.setSessionIdentity(fixture.workerIdentity);

    const response = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({ displayName: "Another Employee", email: "other@example.com", sendEmail: false });

    expect(response.status).toBe(403);
  });

  it("records GPS evidence on the employer profile and completes only the assigned ticket", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Employee",
        email: "employee@example.com",
        assignedJobIds: ["J-9001", "J-9002"],
        assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"],
        sendEmail: false
      });
    const accessToken = decodeURIComponent(new URL(invitation.body.accessLink).hash.replace("#access/", ""));
    await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });
    fixture.setSessionIdentity(fixture.workerIdentity);

    const signoff = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-1",
        typedSignature: "Employee Name",
        attested: true,
        gps: {
          latitude: 42.4501,
          longitude: -73.2452,
          accuracy: 9,
          label: "42.45010, -73.24520 (9m)"
        }
      });

    expect(signoff.status).toBe(201);
    expect(signoff.body.signoff).toMatchObject({
      taskId: "TASK-EMP-1",
      employeeUid: "worker-uid",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha",
      status: "signed",
      gps: {
        latitude: 42.4501,
        longitude: -73.2452,
        accuracy: 9
      }
    });
    expect(fixture.fakeDb.dump("osWorkspaceRecords")["task-document"].data).toMatchObject({
      id: "TASK-EMP-1",
      status: "Complete",
      signedOffByUid: "worker-uid"
    });

    const missingPhotoEvidence = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-2",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(missingPhotoEvidence.status).toBe(409);
    expect(missingPhotoEvidence.body.message).toMatch(/photo evidence/i);

    await fixture.fakeDb.collection("osWorkspaceRecords").doc("photo-task-2").set({
      companyId: "default-company",
      field: "photoRecords",
      recordId: "PHOTO-TASK-2",
      data: {
        id: "PHOTO-TASK-2",
        taskId: "TASK-EMP-2",
        jobId: "J-9002",
        contractorId: "contractor-alpha",
        workerId: "worker-uid",
        workerEmail: "employee@example.com",
        assetId: "workspace-asset-photo-2"
      },
      sortIndex: 0,
      deletedAt: ""
    });
    const fabricatedAssetSignoff = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-2",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(fabricatedAssetSignoff.status).toBe(409);

    await fixture.fakeDb.collection("osWorkspaceAssets").doc("workspace-asset-photo-2").set({
      id: "workspace-asset-photo-2",
      companyId: "default-company",
      taskId: "TASK-EMP-2",
      jobId: "J-9002",
      contractorId: "contractor-alpha",
      workerId: "worker-uid",
      workerEmail: "employee@example.com",
      createdByUid: "worker-uid",
      createdByEmail: "employee@example.com",
      objectPath: "os-workspace/default-company/workspace-asset-photo-2.jpg",
      contentType: "image/jpeg",
      detectedContentType: "image/jpeg",
      contentVerified: true
    });
    const photoTicketSignoff = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-2",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(photoTicketSignoff.status).toBe(201);
    expect(fixture.fakeDb.dump("osWorkspaceRecords")["task-document-2"].data).toMatchObject({
      status: "Complete",
      signedOffByUid: "worker-uid"
    });

    const duplicate = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-1",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(duplicate.status).toBe(409);

    const otherEmployeeTicket = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-OTHER-1",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    expect(otherEmployeeTicket.status).toBe(404);

    await fixture.fakeDb.collection("osEmployeeTicketSignoffs").doc("cross-company-signoff").set({
      id: "cross-company-signoff",
      taskId: "TASK-CROSS-COMPANY",
      companyId: "other-company",
      contractorId: "contractor-alpha",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha",
      employeeUid: "other-company-worker",
      employeeEmail: "other.company.employee@example.com",
      gps: { latitude: 40.7128, longitude: -74.006 },
      signedAt: new Date().toISOString()
    });

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const employerFeed = await request(fixture.app)
      .get("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    expect(employerFeed.status).toBe(200);
    expect(employerFeed.body.ticketSignoffs).toHaveLength(2);
    expect(employerFeed.body.ticketSignoffs.every((entry) => entry.employeeEmail === "employee@example.com")).toBe(true);
  });

  it("serializes simultaneous employee invitations so only the newest link can activate", async () => {
    const fixture = createEmployeeTestApp();
    const invitationRequest = () => request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Concurrent Employee",
        email: "employee@example.com",
        phone: "555-010-3030",
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["jobs", "time"],
        sendEmail: false
      });
    const invitations = await Promise.all([invitationRequest(), invitationRequest()]);

    expect(invitations.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(invitations.map((response) => response.body.grant.id)).size).toBe(1);
    const storedGrants = fixture.fakeDb.dump("osAccessGrants");
    expect(Object.keys(storedGrants)).toHaveLength(1);
    const [storedGrant] = Object.values(storedGrants);
    expect(storedGrant.phone).toBe("555-010-3030");
    const invitationTokens = invitations.map((response) => decodeURIComponent(new URL(response.body.accessLink).hash.replace("#access/", "")));
    const activeToken = invitationTokens.find((token) => crypto.createHash("sha256").update(token).digest("hex") === storedGrant.tokenHash);
    const supersededToken = invitationTokens.find((token) => token !== activeToken);
    expect(activeToken).toBeTruthy();
    expect(supersededToken).toBeTruthy();

    fixture.setSessionIdentity(fixture.workerIdentity);
    const supersededLogin = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken: supersededToken });
    expect(supersededLogin.status).toBe(403);
    const activeLogin = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken: activeToken });
    expect(activeLogin.status).toBe(200);
  });

  it("commits one ticket sign-off when two devices submit the same ticket together", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Employee",
        email: "employee@example.com",
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["jobs", "time"],
        sendEmail: false
      });
    const accessToken = decodeURIComponent(new URL(invitation.body.accessLink).hash.replace("#access/", ""));
    await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });
    fixture.setSessionIdentity(fixture.workerIdentity);
    const signoffRequest = () => request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-1",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });
    const responses = await Promise.all([signoffRequest(), signoffRequest()]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(Object.keys(fixture.fakeDb.dump("osEmployeeTicketSignoffs"))).toHaveLength(1);
    expect(fixture.fakeDb.dump("osWorkspaceRecords")["task-document"].data.status).toBe("Complete");
  });

  it("requires durable GPS clock records, prevents overlapping shifts, and closes the active shift atomically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Employee",
        email: "employee@example.com",
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["jobs", "time"],
        sendEmail: false
      });
    const accessToken = decodeURIComponent(new URL(invitation.body.accessLink).hash.replace("#access/", ""));
    await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });
    fixture.setSessionIdentity(fixture.workerIdentity);
    const initial = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    const invalidClock = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: initial.body.revision,
        baseUpdatedAt: initial.body.updatedAt,
        workspaceState: {
          activeClockSessions: [{ id: "CLOCK-INVALID", job: "J-9001", taskId: "TASK-EMP-1", start: "2026-08-24T12:00:00.000Z" }]
        }
      });
    expect(invalidClock.status).toBe(400);
    expect(invalidClock.body.message).toMatch(/GPS position/i);

    const activeShift = {
      id: "CLOCK-VALID",
      job: "J-9001",
      taskId: "TASK-EMP-1",
      start: "2026-08-24T12:00:00.000Z",
      startGps: { latitude: 42.45, longitude: -73.24, accuracy: 8 }
    };
    const clockIn = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: initial.body.revision,
        baseUpdatedAt: initial.body.updatedAt,
        workspaceState: { activeClockSessions: [activeShift] }
      });
    expect(clockIn.status).toBe(200);

    const overlap = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: clockIn.body.revision,
        baseUpdatedAt: clockIn.body.updatedAt,
        workspaceState: {
          activeClockSessions: [
            activeShift,
            { ...activeShift, id: "CLOCK-OVERLAP", start: "2026-08-24T12:01:00.000Z" }
          ]
        }
      });
    expect(overlap.status).toBe(409);

    const omittedExistingShift = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: clockIn.body.revision,
        baseUpdatedAt: clockIn.body.updatedAt,
        workspaceState: {
          activeClockSessions: [
            { ...activeShift, id: "CLOCK-OMITS-EXISTING", start: "2026-08-24T12:02:00.000Z" }
          ]
        }
      });
    expect(omittedExistingShift.status).toBe(409);
    expect(omittedExistingShift.body.message).toMatch(/already has an active shift/i);

    vi.setSystemTime(new Date("2026-08-24T14:00:00.000Z"));
    const completedEntry = {
      ...activeShift,
      end: "2026-08-24T14:00:00.000Z",
      endGps: { latitude: 42.451, longitude: -73.241, accuracy: 7 },
      hours: "999h"
    };
    const clockOut = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: clockIn.body.revision,
        baseUpdatedAt: clockIn.body.updatedAt,
        workspaceState: { activeClockSessions: [], timeEntries: [completedEntry] }
      });
    expect(clockOut.status).toBe(200);
    expect(fixture.fakeDb.dump("osWorkspaceRecords")["CLOCK-VALID"]).toBeUndefined();
    const activeClockDocument = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "activeClockSessions" && record.recordId === "CLOCK-VALID");
    expect(activeClockDocument.deletedAt).toBeTruthy();
    const storedTimeDocument = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "timeEntries" && record.recordId === "CLOCK-VALID");
    expect(storedTimeDocument.data).toMatchObject({
      start: "2026-08-24T12:00:00.000Z",
      end: "2026-08-24T14:00:00.000Z",
      hours: "2.00",
      workerId: "worker-uid"
    });

    const tamper = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: clockOut.body.revision,
        baseUpdatedAt: clockOut.body.updatedAt,
        workspaceState: { timeEntries: [{ ...storedTimeDocument.data, hours: "999h" }] }
      });
    expect(tamper.status).toBe(200);
    const immutableTimeDocument = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "timeEntries" && record.recordId === "CLOCK-VALID");
    expect(immutableTimeDocument.data.hours).toBe("2.00");

    const unassignedJob = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: tamper.body.revision,
        baseUpdatedAt: tamper.body.updatedAt,
        workspaceState: {
          activeClockSessions: [{ ...activeShift, id: "CLOCK-OTHER", job: "J-OTHER", taskId: "" }]
        }
      });
    expect(unassignedJob.status).toBe(403);
  });

  it("verifies uploaded bytes instead of trusting the declared file type", async () => {
    const fixture = createEmployeeTestApp();
    const spoofed = await request(fixture.app)
      .post("/api/workspace-assets")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        fileName: "evidence.png",
        contentType: "image/png",
        base64: Buffer.from("<script>alert(1)</script>").toString("base64"),
        jobId: "J-9001"
      });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.message).toMatch(/bytes do not match/i);
    expect(Object.keys(fixture.fakeDb.dump("osWorkspaceAssets"))).toHaveLength(0);
    expect(fixture.storageObjects.size).toBe(0);

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const valid = await request(fixture.app)
      .post("/api/workspace-assets")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        fileName: "evidence.png",
        contentType: "image/png",
        base64: pngBytes.toString("base64"),
        jobId: "J-9001"
      });
    expect(valid.status).toBe(201);
    expect(valid.body.asset).toMatchObject({
      contentType: "image/png",
      detectedContentType: "image/png",
      contentVerified: true
    });
    expect(fixture.storageObjects.size).toBe(1);
  });

  it("rejects ambiguous employee assignments that reuse an ID across scopes", async () => {
    const fixture = createEmployeeTestApp();
    await fixture.fakeDb.collection("osWorkspaceRecords").doc("task-document-duplicate").set({
      companyId: "default-company",
      field: "tasks",
      recordId: "TASK-EMP-1",
      data: {
        id: "TASK-EMP-1",
        title: "Duplicate scoped ticket",
        moduleKey: "jobs",
        relatedJob: "J-9001",
        franchiseId: "default-franchise",
        branchId: "branch-two",
        contractorId: "contractor-alpha"
      },
      sortIndex: 99,
      deletedAt: ""
    });
    const response = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Employee",
        email: "employee@example.com",
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["jobs"],
        sendEmail: false
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/scoped record|duplicate/i);
    expect(Object.keys(fixture.fakeDb.dump("osAccessGrants"))).toHaveLength(0);
  });

  it("rejects a worker-created completed time entry without a matching active shift", async () => {
    const fixture = createEmployeeTestApp();
    await seedActiveWorker(fixture);
    const initial = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);

    const forged = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: initial.body.revision,
        baseUpdatedAt: initial.body.updatedAt,
        workspaceState: {
          timeEntries: [{
            id: "TIME-STANDALONE-FORGED",
            job: "J-9001",
            taskId: "TASK-EMP-1",
            start: "2026-08-24T12:00:00.000Z",
            end: "2026-08-24T14:00:00.000Z",
            startGps: { latitude: 42.45, longitude: -73.24, accuracy: 8 },
            endGps: { latitude: 42.451, longitude: -73.241, accuracy: 7 },
            hours: "999h"
          }]
        }
      });

    expect(forged.status).toBe(409);
    expect(forged.body.message).toMatch(/active shift|clock/i);
    const forgedDocument = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "timeEntries" && record.recordId === "TIME-STANDALONE-FORGED");
    expect(forgedDocument).toBeUndefined();
  });

  it("consumes the matching active shift and calculates completed time on the server", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const fixture = createEmployeeTestApp();
    await seedActiveWorker(fixture);
    const initial = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    const activeShift = {
      id: "CLOCK-SERVER-AUTHORITY",
      job: "J-9001",
      taskId: "TASK-EMP-1",
      start: "2026-08-24T12:00:00.000Z",
      startGps: { latitude: 42.45, longitude: -73.24, accuracy: 8 }
    };
    const clockIn = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: initial.body.revision,
        baseUpdatedAt: initial.body.updatedAt,
        workspaceState: { activeClockSessions: [activeShift] }
      });
    expect(clockIn.status).toBe(200);

    vi.setSystemTime(new Date("2026-08-24T14:15:00.000Z"));
    const clockOut = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        baseRevision: clockIn.body.revision,
        baseUpdatedAt: clockIn.body.updatedAt,
        workspaceState: {
          activeClockSessions: [],
          timeEntries: [{
            ...activeShift,
            start: "1999-01-01T00:00:00.000Z",
            end: "2099-01-01T00:00:00.000Z",
            endGps: { latitude: 42.451, longitude: -73.241, accuracy: 7 },
            hours: "999h"
          }]
        }
      });

    expect(clockOut.status).toBe(200);
    const storedActiveShift = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "activeClockSessions" && record.recordId === activeShift.id);
    const storedTime = Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))
      .find((record) => record.field === "timeEntries" && record.recordId === activeShift.id);
    expect(storedActiveShift?.deletedAt).toBe("2026-08-24T14:15:00.000Z");
    expect(storedTime?.data).toMatchObject({
      id: activeShift.id,
      start: "2026-08-24T12:00:00.000Z",
      end: "2026-08-24T14:15:00.000Z",
      hours: "2.25",
      workerId: "worker-uid"
    });
  });

  it("does not let an explicit assignee identity bypass contractor isolation", async () => {
    const fixture = createEmployeeTestApp();
    await seedActiveWorker(fixture, {
      contractorId: "contractor-beta",
      employerUid: "other-contractor-uid",
      employerEmail: "other.contractor@example.com",
      employerContractorId: "contractor-beta",
      visibleTabIds: ["jobs"],
      visiblePageIds: ["jobs"],
      assignedJobIds: ["J-9001"],
      assignedTaskIds: ["TASK-EMP-1"]
    });

    const workerWorkspace = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=worker-session"]);
    expect(workerWorkspace.status).toBe(200);
    expect(workerWorkspace.body.workspaceState.tasks || []).not.toContainEqual(
      expect.objectContaining({ id: "TASK-EMP-1" })
    );

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const contractorWorkspace = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    const crossContractorAssignment = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        baseRevision: contractorWorkspace.body.revision,
        baseUpdatedAt: contractorWorkspace.body.updatedAt,
        workspaceState: {
          tasks: [{
            id: "TASK-CROSS-CONTRACTOR-ASSIGNEE",
            title: "Must remain in contractor alpha",
            moduleKey: "jobs",
            relatedJob: "J-9001",
            assigneeId: "worker-uid",
            assigneeEmail: "employee@example.com",
            status: "Open"
          }]
        }
      });

    expect(crossContractorAssignment.status).toBe(403);
    expect(crossContractorAssignment.body.message).toMatch(/assignee|contractor|employee/i);
    expect(Object.values(fixture.fakeDb.dump("osWorkspaceRecords"))).not.toContainEqual(
      expect.objectContaining({ recordId: "TASK-CROSS-CONTRACTOR-ASSIGNEE" })
    );
  });

  it("stores a ticket sign-off only in the task's exact franchise and branch scope", async () => {
    const fixture = createEmployeeTestApp();
    const originalJob = fixture.fakeDb.dump("osWorkspaceRecords")["job-9001"];
    const originalTask = fixture.fakeDb.dump("osWorkspaceRecords")["task-document"];
    await fixture.fakeDb.collection("osWorkspaceRecords").doc("job-9001").set({
      data: { ...originalJob.data, franchiseId: "franchise-one", branchId: "branch-one" }
    }, { merge: true });
    await fixture.fakeDb.collection("osWorkspaceRecords").doc("task-document").set({
      data: { ...originalTask.data, franchiseId: "franchise-one", branchId: "branch-one" }
    }, { merge: true });
    await seedActiveWorker(fixture, {
      franchiseIds: ["franchise-one", "franchise-two"],
      assignedJobIds: ["J-9001"],
      assignedTaskIds: ["TASK-EMP-1"],
      visibleTabIds: ["jobs"],
      visiblePageIds: ["jobs"]
    });

    const response = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-1",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });

    expect(response.status).toBe(201);
    expect(response.body.signoff).toMatchObject({
      franchiseId: "franchise-one",
      branchId: "branch-one"
    });
    expect(response.body.signoff.franchiseIds).toEqual(["franchise-one"]);
    expect(fixture.fakeDb.dump("osEmployeeTicketSignoffs")[response.body.signoff.id]).toMatchObject({
      franchiseId: "franchise-one",
      branchId: "branch-one",
      franchiseIds: ["franchise-one"]
    });
  });

  it("activates an invitation with the permissions reread inside the transaction", async () => {
    const fixture = createEmployeeTestApp();
    const invitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Restricted Before Activation",
        email: "employee@example.com",
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
        visibleModuleKeys: ["jobs", "time"],
        sendEmail: false
      });
    expect(invitation.status).toBe(201);
    const accessToken = decodeURIComponent(new URL(invitation.body.accessLink).hash.replace("#access/", ""));
    fixture.fakeDb.setBeforeNextTransaction(async () => {
      await fixture.fakeDb.collection("osAccessGrants").doc(invitation.body.grant.id).set({
        visibleTabIds: ["time"],
        visiblePageIds: ["time"],
        assignedJobIds: [],
        assignedTaskIds: [],
        assignedJobScopeKeys: [],
        assignedTaskScopeKeys: [],
        jobTitle: "Restricted Technician",
        updatedAt: "2026-08-24T15:00:00.000Z"
      }, { merge: true });
    });

    fixture.setSessionIdentity(fixture.workerIdentity);
    const login = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });

    expect(login.status).toBe(200);
    expect(login.body.session.visibleTabIds).toEqual(["time"]);
    expect(login.body.session.visiblePageIds).toEqual(["time"]);
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"]).toMatchObject({
      visibleTabIds: ["time"],
      visiblePageIds: ["time"],
      assignedJobIds: [],
      assignedTaskIds: [],
      assignedJobScopeKeys: [],
      assignedTaskScopeKeys: [],
      jobTitle: "Restricted Technician"
    });
  });

  it("keys pending employee invitations by contractor and supersedes only that contractor's older token", async () => {
    const fixture = createEmployeeTestApp();
    const invite = () => request(fixture.app)
      .post("/api/employee-invitations")
      .set("host", "www.brothers.ad")
      .set("x-forwarded-proto", "https")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Shared Email Employee",
        email: "shared.employee@example.com",
        visibleModuleKeys: ["time"],
        sendEmail: false
      });

    const firstAlphaInvitation = await invite();
    expect(firstAlphaInvitation.status).toBe(201);
    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const betaInvitation = await invite();
    expect(betaInvitation.status).toBe(201);
    fixture.setSessionIdentity(fixture.contractorIdentity);
    const secondAlphaInvitation = await invite();
    expect(secondAlphaInvitation.status).toBe(201);

    expect(firstAlphaInvitation.body.grant.id).toBe(secondAlphaInvitation.body.grant.id);
    expect(firstAlphaInvitation.body.grant.id).not.toBe(betaInvitation.body.grant.id);
    const firstAlphaToken = decodeURIComponent(new URL(firstAlphaInvitation.body.accessLink).hash.replace("#access/", ""));
    const secondAlphaToken = decodeURIComponent(new URL(secondAlphaInvitation.body.accessLink).hash.replace("#access/", ""));
    const betaToken = decodeURIComponent(new URL(betaInvitation.body.accessLink).hash.replace("#access/", ""));
    const storedGrants = fixture.fakeDb.dump("osAccessGrants");
    expect(Object.keys(storedGrants)).toHaveLength(2);
    expect(storedGrants[firstAlphaInvitation.body.grant.id]).toMatchObject({
      contractorId: "contractor-alpha",
      employerContractorId: "contractor-alpha",
      status: "issued",
      tokenHash: crypto.createHash("sha256").update(secondAlphaToken).digest("hex")
    });
    expect(storedGrants[firstAlphaInvitation.body.grant.id].tokenHash)
      .not.toBe(crypto.createHash("sha256").update(firstAlphaToken).digest("hex"));
    expect(storedGrants[betaInvitation.body.grant.id]).toMatchObject({
      contractorId: "contractor-beta",
      employerContractorId: "contractor-beta",
      status: "issued",
      tokenHash: crypto.createHash("sha256").update(betaToken).digest("hex")
    });
  });

  it("persists the same record ID independently for two contractors", async () => {
    const fixture = createEmployeeTestApp();
    const alphaWorkspace = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    const alphaWrite = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        baseRevision: alphaWorkspace.body.revision,
        baseUpdatedAt: alphaWorkspace.body.updatedAt,
        workspaceState: {
          jobBoards: [{ id: "JOB-SHARED-SCOPE", jobId: "J-SHARED-SCOPE", title: "Alpha scoped job" }]
        }
      });
    expect(alphaWrite.status).toBe(200);

    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const betaWorkspace = await request(fixture.app)
      .get("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=other-contractor-session"]);
    const betaWrite = await request(fixture.app)
      .put("/api/workspace-state")
      .set("Cookie", ["brothers_os_session=other-contractor-session"])
      .send({
        baseRevision: betaWorkspace.body.revision,
        baseUpdatedAt: betaWorkspace.body.updatedAt,
        workspaceState: {
          jobBoards: [{ id: "JOB-SHARED-SCOPE", jobId: "J-SHARED-SCOPE", title: "Beta scoped job" }]
        }
      });
    expect(betaWrite.status).toBe(200);

    const scopedDocuments = Object.entries(fixture.fakeDb.dump("osWorkspaceRecords"))
      .filter(([, record]) => record.field === "jobBoards"
        && record.recordId === "JOB-SHARED-SCOPE"
        && !record.deletedAt);
    expect(scopedDocuments).toHaveLength(2);
    expect(new Set(scopedDocuments.map(([documentId]) => documentId)).size).toBe(2);
    expect(scopedDocuments.map(([, record]) => record.data.contractorId).sort())
      .toEqual(["contractor-alpha", "contractor-beta"]);
  });

  it("qualifies duplicate assignment IDs by contractor scope", async () => {
    const fixture = createEmployeeTestApp();
    await fixture.fakeDb.collection("osWorkspaceRecords").doc("shared-job-alpha").set({
      companyId: "default-company",
      field: "jobBoards",
      recordId: "J-DUPLICATE-CONTRACTOR",
      data: {
        id: "JOB-DUPLICATE-CONTRACTOR",
        jobId: "J-DUPLICATE-CONTRACTOR",
        title: "Alpha duplicate ID",
        franchiseId: "default-franchise",
        contractorId: "contractor-alpha"
      },
      sortIndex: 20,
      deletedAt: ""
    });
    await fixture.fakeDb.collection("osWorkspaceRecords").doc("shared-job-beta").set({
      companyId: "default-company",
      field: "jobBoards",
      recordId: "J-DUPLICATE-CONTRACTOR",
      data: {
        id: "JOB-DUPLICATE-CONTRACTOR",
        jobId: "J-DUPLICATE-CONTRACTOR",
        title: "Beta duplicate ID",
        franchiseId: "default-franchise",
        contractorId: "contractor-beta"
      },
      sortIndex: 21,
      deletedAt: ""
    });

    const alphaInvitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({
        displayName: "Alpha Employee",
        email: "alpha.employee@example.com",
        assignedJobIds: ["J-DUPLICATE-CONTRACTOR"],
        visibleModuleKeys: ["jobs"],
        sendEmail: false
      });
    fixture.setSessionIdentity(fixture.otherContractorIdentity);
    const betaInvitation = await request(fixture.app)
      .post("/api/employee-invitations")
      .set("Cookie", ["brothers_os_session=other-contractor-session"])
      .send({
        displayName: "Beta Employee",
        email: "beta.employee@example.com",
        assignedJobIds: ["J-DUPLICATE-CONTRACTOR"],
        visibleModuleKeys: ["jobs"],
        sendEmail: false
      });

    expect(alphaInvitation.status).toBe(201);
    expect(betaInvitation.status).toBe(201);
    expect(alphaInvitation.body.grant.assignedJobScopeKeys).toHaveLength(1);
    expect(betaInvitation.body.grant.assignedJobScopeKeys).toHaveLength(1);
    expect(alphaInvitation.body.grant.assignedJobScopeKeys[0])
      .not.toBe(betaInvitation.body.grant.assignedJobScopeKeys[0]);
  });

  it("preserves the transaction-validated photo asset ID and digest on a ticket sign-off", async () => {
    const fixture = createEmployeeTestApp();
    await seedActiveWorker(fixture, {
      assignedJobIds: ["J-9002"],
      assignedTaskIds: ["TASK-EMP-2"],
      visibleTabIds: ["photos"],
      visiblePageIds: ["photos"]
    });
    const evidence = await seedPhotoTicketEvidence(fixture);

    const response = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-2",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });

    expect(response.status).toBe(201);
    const responseEvidence = signoffEvidenceValues(response.body.signoff);
    const storedEvidence = signoffEvidenceValues(
      fixture.fakeDb.dump("osEmployeeTicketSignoffs")[response.body.signoff.id]
    );
    expect(responseEvidence.assetIds).toContain(evidence.assetId);
    expect(responseEvidence.digests).toContain(evidence.digest);
    expect(storedEvidence.assetIds).toContain(evidence.assetId);
    expect(storedEvidence.digests).toContain(evidence.digest);
  });

  it("rejects a ticket sign-off when photo evidence changes before the transaction", async () => {
    const fixture = createEmployeeTestApp();
    await seedActiveWorker(fixture, {
      assignedJobIds: ["J-9002"],
      assignedTaskIds: ["TASK-EMP-2"],
      visibleTabIds: ["photos"],
      visiblePageIds: ["photos"]
    });
    const evidence = await seedPhotoTicketEvidence(fixture, { assetId: "asset-raced-before-signoff" });
    fixture.fakeDb.setBeforeNextTransaction(async () => {
      await fixture.fakeDb.collection("osWorkspaceAssets").doc(evidence.assetId).set({
        contentVerified: false,
        sha256: crypto.createHash("sha256").update("changed-photo-bytes").digest("hex"),
        updatedAt: "2026-08-24T15:00:00.000Z"
      }, { merge: true });
    });

    const response = await request(fixture.app)
      .post("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=worker-session"])
      .send({
        taskId: "TASK-EMP-2",
        typedSignature: "Employee Name",
        attested: true,
        gps: { latitude: 42.4501, longitude: -73.2452, accuracy: 9 }
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/photo evidence|changed|reload/i);
    expect(Object.keys(fixture.fakeDb.dump("osEmployeeTicketSignoffs"))).toHaveLength(0);
    expect(fixture.fakeDb.dump("osWorkspaceRecords")["task-document-2"].data.status).toBe("Open");
  });
});
