import crypto from "crypto";
import { createRequire } from "module";
import { afterEach, describe, expect, it } from "vitest";
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
  const workerIdentity = googleIdentity("worker-uid", "employee@example.com", "Employee");
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
      }
    },
    osWorkspaceRecords: {
      "task-document": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-EMP-1",
        data: {
          id: "TASK-EMP-1",
          title: "Document final room condition",
          relatedJob: "J-9001",
          assigneeId: "worker-uid",
          assigneeEmail: "employee@example.com",
          status: "Open"
        },
        sortIndex: 0,
        deletedAt: ""
      },
      "other-task-document": {
        companyId: "default-company",
        field: "tasks",
        recordId: "TASK-OTHER-1",
        data: {
          id: "TASK-OTHER-1",
          title: "Other employee ticket",
          relatedJob: "J-9001",
          assigneeId: "other-worker-uid",
          assigneeEmail: "other.employee@example.com",
          status: "Open"
        },
        sortIndex: 1,
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
    createSessionCookie: async () => "created-session-cookie",
    revokeRefreshTokens: async () => undefined
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
    getFirebaseStorageBucket: () => null,
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
    workerIdentity
  };
}

afterEach(() => {
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
        displayName: "Employee",
        email: "employee@example.com",
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
      assignedTaskIds: ["TASK-EMP-1"],
      visiblePageIds: ["time", "jobs"]
    });
    expect(invitation.body.grant.tokenHash).toBeUndefined();

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
      accessScope: "employee_portal"
    });
    expect(fixture.fakeDb.dump("osUsers")["worker-uid"]).toMatchObject({
      roleId: "worker",
      employerUid: "contractor-uid",
      employerContractorId: "contractor-alpha",
      employmentStatus: "active",
      assignedTaskIds: ["TASK-EMP-1"]
    });

    const assignmentUpdate = await request(fixture.app)
      .patch("/api/employees/worker-uid/assignments")
      .set("Cookie", ["brothers_os_session=contractor-session"])
      .send({ assignedJobIds: ["J-9001", "J-9002"], assignedTaskIds: ["TASK-EMP-1", "TASK-EMP-2"] });
    expect(assignmentUpdate.status).toBe(200);
    expect(assignmentUpdate.body.user.assignedTaskIds).toEqual(["TASK-EMP-1", "TASK-EMP-2"]);

    const reusedLink = await request(fixture.app)
      .post("/api/auth/session/login")
      .send({ idToken: "verified-worker-token", accessToken });
    expect(reusedLink.status).toBe(403);
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
        assignedJobIds: ["J-9001"],
        assignedTaskIds: ["TASK-EMP-1"],
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
    expect(otherEmployeeTicket.status).toBe(403);

    fixture.setSessionIdentity(fixture.contractorIdentity);
    const employerFeed = await request(fixture.app)
      .get("/api/employee/ticket-signoffs")
      .set("Cookie", ["brothers_os_session=contractor-session"]);
    expect(employerFeed.status).toBe(200);
    expect(employerFeed.body.ticketSignoffs).toHaveLength(1);
    expect(employerFeed.body.ticketSignoffs[0].employeeEmail).toBe("employee@example.com");
  });
});
