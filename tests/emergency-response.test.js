import crypto from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const require = createRequire(import.meta.url);
const express = require("express");
const { mountEmergencyResponseRoutes } = require("../lib/emergency-response");
const { createFirebaseRbacRouter } = require("../lib/firebase-rbac-routes");
const NOW = Date.parse("2026-09-19T14:00:00.000Z");
const SOURCE = {
  id: "county-a", label: "County A Dispatch", area: "County A", companyId: "company-a",
  secret: "a".repeat(64), streamUrl: "https://radio.example/listen"
};
const OTHER_SOURCE = { ...SOURCE, id: "county-b", companyId: "company-b", secret: "b".repeat(64) };
const EVENT = {
  eventId: "event-123", type: "fire", location: "100 Example Street",
  occurredAt: "2026-09-19T13:59:00Z", units: ["Engine 1"], summary: "Structure fire reported."
};
const SESSION = {
  uid: "business-owner", email: "owner@example.com", roleId: "business_owner", companyId: "company-a",
  permissions: { pages: { mode: "all", allowed: [], hidden: [] } },
  visiblePageIds: ["dispatch"], status: "active", disabled: false
};

function fakeFirestore() {
  const store = new Map();
  const operations = [];
  let queue = Promise.resolve();
  let failReads = false;
  let failTransactions = false;
  const snapshot = (path) => ({
    id: path.split("/").at(-1), exists: store.has(path), data: () => structuredClone(store.get(path))
  });
  function doc(path) {
    return {
      id: path.split("/").at(-1), path,
      collection: (name) => collection(`${path}/${name}`),
      get: async () => {
        operations.push({ type: "get", path });
        if (failReads && path.startsWith("osEmergencyCompanies/")) throw new Error("Private datastore failure");
        return snapshot(path);
      },
      set: async (data, options = {}) => {
        store.set(path, structuredClone(options.merge ? { ...store.get(path), ...data } : data));
      }
    };
  }
  function collection(path, filters = [], sort = null, bound = null) {
    return {
      doc: (id) => doc(`${path}/${id}`),
      where: (field, operator, value) => {
        if (operator !== "==") throw new Error("Unexpected test query operator");
        return collection(path, [...filters, [field, value]], sort, bound);
      },
      orderBy: (field, direction) => collection(path, filters, [field, direction], bound),
      limit: (count) => collection(path, filters, sort, count),
      get: async () => {
        operations.push({ type: "query", path, bound, sort });
        if (failReads && path.startsWith("osEmergencyCompanies/")) throw new Error("Private datastore failure");
        let docs = [...store.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .map(snapshot).filter((entry) => filters.every(([field, value]) => entry.data()[field] === value));
        if (sort) docs.sort((a, b) => String(a.data()[sort[0]]).localeCompare(String(b.data()[sort[0]])) * (sort[1] === "desc" ? -1 : 1));
        if (bound !== null) docs = docs.slice(0, bound);
        return { docs, empty: docs.length === 0 };
      }
    };
  }
  return {
    collection,
    operations,
    store,
    setFailReads(value) { failReads = value; },
    setFailTransactions(value) { failTransactions = value; },
    batch() {
      const writes = [];
      return { set: (...args) => writes.push(args), commit: async () => {
        for (const [ref, data, options] of writes) await ref.set(data, options);
      } };
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        if (failTransactions) throw new Error("Private transaction failure");
        const writes = [];
        const result = await callback({
          get: (ref) => ref.get(),
          set: (...args) => writes.push(args)
        });
        for (const [ref, data, options] of writes) {
          operations.push({ type: "transactionWrite", path: ref.path });
          await ref.set(data, options);
        }
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    }
  };
}

function testApp(options = {}) {
  const db = options.db === undefined ? fakeFirestore() : options.db;
  let session = options.session === undefined ? structuredClone(SESSION) : options.session;
  const app = express();
  app.use(express.json({
    limit: "128kb",
    verify(req, _res, buffer) {
      if (options.rawCapture !== false) req.rawBody = Buffer.from(buffer);
    }
  }));
  if (options.mutateBody) app.use((req, _res, next) => { req.body = options.mutateBody(req.body); next(); });
  const router = express.Router();
  mountEmergencyResponseRoutes({
    router,
    requireSession(req, res, next) {
      if (!session || !req.get("cookie")) return res.status(401).json({ success: false, message: "Authentication required." });
      req.osSession = session;
      next();
    },
    getFirestore: () => db,
    isOwnerIdentity: (uid, email) => uid === "real-owner" && email === "david@brothersrestoration.org",
    canAccessDispatch: (value) => options.dispatchAllowed !== false && value.permissions?.pages?.hidden?.includes("dispatch") !== true,
    env: options.env || { EMERGENCY_FEEDS_JSON: JSON.stringify([SOURCE, OTHER_SOURCE]) },
    now: () => NOW
  });
  app.use(router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ success: false, message: "Invalid request." }));
  return { app, db, setSession: (value) => { session = value; } };
}

function signed(app, payload = EVENT, options = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const timestamp = options.timestamp === undefined ? String(NOW / 1000) : options.timestamp;
  const signature = options.signature === undefined
    ? `sha256=${crypto.createHmac("sha256", options.secret || SOURCE.secret).update(`${timestamp}.${body}`).digest("hex")}`
    : options.signature;
  const call = request(app).post(`/api/emergency/webhooks/${options.sourceId || SOURCE.id}`).set("Content-Type", "application/json");
  if (timestamp !== null) call.set("x-emergency-timestamp", timestamp);
  if (signature !== null) call.set("x-emergency-signature", signature);
  return call.send(body);
}

function office(app, method, path = "/api/emergency/incidents") {
  return request(app)[method](path).set("Cookie", "brothers_os_session=test");
}

async function seedDispatch(db, id, incidentId, overrides = {}) {
  await db.collection("osWorkspaceRecords").doc(`workspace-${id}`).set({
    companyId: "company-a", field: "moduleRecords", recordId: id, deletedAt: "",
    data: { id, moduleKey: "dispatch", sourceIncidentId: incidentId }, ...overrides
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("emergency webhook authentication and persistence", () => {
  it("stores incident-only data under the server-configured company and returns no secret", async () => {
    const { app, db } = testApp();
    const response = await signed(app);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, id: expect.stringMatching(/^[a-f0-9]{64}$/), duplicate: false });
    const [[path, record]] = [...db.store];
    expect(path).toBe(`osEmergencyCompanies/${crypto.createHash("sha256").update(SOURCE.companyId).digest("hex")}/incidents/${response.body.id}`);
    expect(record).toMatchObject({ ...EVENT, occurredAt: "2026-09-19T13:59:00.000Z", companyId: "company-a", sourceId: SOURCE.id, reviewStatus: "new", linkedRecordId: null });
    expect(JSON.stringify(record)).not.toContain(SOURCE.secret);
    expect(record).not.toHaveProperty("rawBody");
  });

  it.each([
    { signature: null }, { timestamp: null }, { signature: "" }, { signature: "sha256=00" },
    { signature: `sha256=${"z".repeat(64)}` }, { signature: `sha256=${"0".repeat(64)}` },
    { signature: `SHA256=${"a".repeat(64)}` }, { timestamp: "not-a-time" },
    { timestamp: String(NOW) }, { timestamp: `${NOW / 1000}.0` },
    { timestamp: String(NOW / 1000 - 301) }, { timestamp: String(NOW / 1000 + 301) },
    { sourceId: "unknown" }, { secret: OTHER_SOURCE.secret }
  ])("rejects invalid authentication without datastore writes: %j", async (options) => {
    const { app, db } = testApp();
    expect((await signed(app, EVENT, options)).status).toBe(401);
    expect(db.operations).toEqual([]);
    expect(db.store.size).toBe(0);
  });

  it("rejects a changed body signed for the original bytes", async () => {
    const { app, db } = testApp();
    const signature = `sha256=${crypto.createHmac("sha256", SOURCE.secret).update(`${NOW / 1000}.${JSON.stringify(EVENT)}`).digest("hex")}`;
    expect((await signed(app, { ...EVENT, location: "Changed" }, { signature })).status).toBe(401);
    expect(db.store.size).toBe(0);
  });

  it("uses signed raw bytes even if later middleware changes the parsed body", async () => {
    const { app, db } = testApp({ mutateBody: (body) => ({ ...body, location: "Changed" }) });
    expect((await signed(app, JSON.stringify(EVENT, null, 2))).status).toBe(201);
    expect([...db.store.values()][0].location).toBe(EVENT.location);
  });

  it.each([-300, 300])("accepts the inclusive five-minute boundary (%s seconds)", async (offset) => {
    const { app } = testApp();
    expect((await signed(app, EVENT, { timestamp: String(NOW / 1000 + offset) })).status).toBe(201);
  });

  it("deduplicates concurrent retries in transactions", async () => {
    const { app, db } = testApp();
    const responses = await Promise.all(Array.from({ length: 8 }, () => signed(app)));
    expect(responses.filter((result) => result.status === 201)).toHaveLength(1);
    expect(responses.filter((result) => result.status === 200 && result.body.duplicate)).toHaveLength(7);
    expect(new Set(responses.map((result) => result.body.id)).size).toBe(1);
    expect(db.store.size).toBe(1);
    expect(db.operations.filter((operation) => operation.type === "transactionWrite")).toHaveLength(1);
  });

  it("recognizes reformatted retries and never overwrites review state", async () => {
    const { app, db } = testApp();
    const first = await signed(app);
    await seedDispatch(db, "dispatch-123", first.body.id);
    await office(app, "patch", `/api/emergency/incidents/${first.body.id}`).send({ reviewStatus: "reviewed" }).expect(200);
    await office(app, "patch", `/api/emergency/incidents/${first.body.id}`).send({ reviewStatus: "linked", linkedRecordId: "dispatch-123" }).expect(200);
    const retry = await signed(app, JSON.stringify(EVENT, null, 2));
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    const listing = await office(app, "get");
    expect(listing.body.incidents[0]).toMatchObject({ reviewStatus: "linked", linkedRecordId: "dispatch-123" });
  });

  it("rejects reusing an event ID for different data", async () => {
    const { app, db } = testApp();
    await signed(app).expect(201);
    await signed(app, { ...EVENT, type: "water" }).expect(409);
    expect([...db.store.values()][0].type).toBe("fire");
  });

  it("fails closed without raw bytes, Firestore credentials, or successful transactions", async () => {
    expect((await signed(testApp({ rawCapture: false }).app)).status).toBe(503);
    expect((await signed(testApp({ db: null }).app)).status).toBe(503);
    expect((await signed(testApp({ db: { collection() {} } }).app)).status).toBe(503);
    const { app, db } = testApp();
    db.setFailTransactions(true);
    const response = await signed(app);
    expect(response.status).toBe(503);
    expect(response.text).not.toContain("Private");
    expect(db.store.size).toBe(0);
    db.setFailTransactions(false);
    await signed(app).expect(201);
  });
});

describe("strict incident validation", () => {
  it.each(["homeownerName", "phone", "email", "contact", "contacts", "contactId", "companyId", "sourceId", "reviewStatus", "linkedRecordId", "__proto__", "constructor"])("rejects the unknown field %s", async (field) => {
    const { app, db } = testApp();
    const payload = { ...EVENT, [field]: "not-allowed" };
    await signed(app, payload).expect(400);
    await office(app, "post").set("Content-Type", "application/json").send(JSON.stringify(payload)).expect(400);
    expect(db.store.size).toBe(0);
  });

  it.each([
    { eventId: "" }, { eventId: null }, { eventId: "x".repeat(161) }, { id: "conflicting-alias" },
    { type: "police" }, { type: ["fire"] }, { location: { address: "100 Example Street", phone: "123" } },
    { location: "x".repeat(501) }, { summary: "x".repeat(2001) }, { summary: { email: "a@example.com" } },
    { occurredAt: "yesterday" }, { occurredAt: "2026-02-30T13:00:00Z" }, { occurredAt: "2026-09-19T13:00:00-04:00" },
    { units: "Engine 1" }, { units: [{ phone: "123" }] }, { units: Array(51).fill("Engine") },
    { units: ["x".repeat(81)] }, { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "http://example.com/event" }, { sourceUrl: "https://user:password@example.com/event" },
    { sourceUrl: "https://example.com/event?token=private" }, { sourceUrl: "https://example.com/event#private" }
  ])("rejects invalid fields: %j", async (patch) => {
    const { app, db } = testApp();
    await signed(app, { ...EVENT, ...patch }).expect(400);
    expect(db.store.size).toBe(0);
  });

  it.each([[], null, "string", {}, { eventId: "only-id" }])("rejects a malformed incident: %j", async (payload) => {
    const { app } = testApp();
    await signed(app, JSON.stringify(payload)).expect(400);
  });

  it("accepts the id alias, all enum values, and optional public source URLs", async () => {
    const { app } = testApp();
    for (const type of ["fire", "water", "storm", "rescue", "hazardous_material", "other"]) {
      const { eventId, ...fields } = EVENT;
      await signed(app, { ...fields, id: `${eventId}-${type}`, type, sourceUrl: "https://dispatch.example/incidents/123" }).expect(201);
    }
  });

  it("enforces 32 KiB even when the outer JSON parser has a higher limit", async () => {
    const { app, db } = testApp();
    await signed(app, `${" ".repeat(32768)}${JSON.stringify(EVENT)}`).expect(413);
    await office(app, "post").send({ ...EVENT, summary: "x".repeat(32768) }).expect(413);
    expect(db.store.size).toBe(0);
  });

  it("requires JSON for office writes and rejects malformed JSON", async () => {
    const { app } = testApp();
    await office(app, "post").set("Content-Type", "text/plain").send(JSON.stringify(EVENT)).expect(415);
    await signed(app, '{"eventId":').expect(400);
  });
});

describe("office access, status, and tenant isolation", () => {
  it.each(["worker", "contractor", "franchise_owner", "manager", "admin", "", "super_admin"])("denies %s on every office route even with dispatch granted", async (roleId) => {
    const { app, db } = testApp({ session: { ...SESSION, roleId } });
    for (const [method, path] of [["get", "/status"], ["get", "/incidents"], ["post", "/incidents"], ["patch", `/incidents/${"a".repeat(64)}`]]) {
      await office(app, method, `/api/emergency${path}`).send(method === "get" ? undefined : EVENT).expect(403);
    }
    expect(db.operations).toEqual([]);
  });

  it("requires a session and explicitly granted dispatch access", async () => {
    const { app } = testApp();
    await request(app).get("/api/emergency/status").expect(401);
    await office(testApp({ dispatchAllowed: false }).app, "get").expect(403);
    await office(testApp({ session: { ...SESSION, companyId: "" } }).app, "get").expect(403);
    await office(testApp({ session: { ...SESSION, disabled: true } }).app, "get").expect(403);
  });

  it("allows the real owner without global tenant access", async () => {
    const { app } = testApp({ session: { ...SESSION, roleId: "super_admin", uid: "real-owner", email: "david@brothersrestoration.org" } });
    const response = await office(app, "get", "/api/emergency/status");
    expect(response.status).toBe(200);
    expect(response.body.sources.map((source) => source.id)).toEqual([SOURCE.id]);
    await office(app, "get", "/api/emergency/incidents?companyId=company-b").expect(400);
  });

  it("returns only safe source metadata and accurate runtime availability", async () => {
    const { app, db } = testApp();
    const response = await office(app, "get", "/api/emergency/status");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      success: true, configured: true, configurationValid: true, webhookReady: true,
      runtime: { storage: "firestore", available: true, reason: null },
      sources: [{ id: SOURCE.id, label: SOURCE.label, area: SOURCE.area, streamUrl: SOURCE.streamUrl }],
      reviewStatuses: ["new", "reviewed", "linked", "dismissed"],
      limits: { payloadBytes: 32768, maxIncidents: 100, timestampSkewSeconds: 300 }
    });
    expect(response.text).not.toContain(SOURCE.secret);
    expect(response.text).not.toContain("company-b");
    db.setFailReads(true);
    const unavailable = await office(app, "get", "/api/emergency/status");
    expect(unavailable.body.runtime).toEqual({ storage: "firestore", available: false, reason: "storage_unavailable" });
    expect(unavailable.body.webhookReady).toBe(false);
    await office(app, "get").expect(503);
  });

  it("reports unconfigured feeds without inventing sample incidents or requiring feeds for manual entry", async () => {
    const { app } = testApp({ env: {} });
    const response = await office(app, "get", "/api/emergency/status");
    expect(response.body).toMatchObject({ configured: false, configurationValid: true, sources: [], webhookReady: false });
    expect((await office(app, "get")).body.incidents).toEqual([]);
    await signed(app).expect(401);
    await office(app, "post").send(EVENT).expect(201);
  });

  it.each([
    "not-json", "{}", JSON.stringify([{ ...SOURCE, secret: "short" }]),
    JSON.stringify([SOURCE, SOURCE]), JSON.stringify([SOURCE, { ...OTHER_SOURCE, secret: SOURCE.secret }]),
    JSON.stringify([{ ...SOURCE, companyId: "../company-b" }]),
    JSON.stringify([{ ...SOURCE, extra: true }]),
    ...["http://radio.example/", "https://user:secret@radio.example/", "https://radio.example/?token=private", "javascript:alert(1)", "https://radio.example/#private"].map((streamUrl) => JSON.stringify([{ ...SOURCE, streamUrl }]))
  ])("fails closed on invalid feed configuration or unsafe streams: %s", async (configuration) => {
    const { app } = testApp({ env: { EMERGENCY_FEEDS_JSON: configuration } });
    const response = await office(app, "get", "/api/emergency/status");
    expect(response.body).toMatchObject({ configured: false, configurationValid: false, sources: [], webhookReady: false });
    expect(response.text).not.toContain("private");
    await signed(app).expect(503);
  });

  it("isolates tenant lists, updates, and manual writes", async () => {
    const { app, db, setSession } = testApp();
    const first = await signed(app);
    const second = await signed(app, { ...EVENT, location: "Tenant B incident" }, { sourceId: OTHER_SOURCE.id, secret: OTHER_SOURCE.secret });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    const listed = await office(app, "get");
    expect(listed.body.incidents.map((incident) => incident.id)).toEqual([first.body.id]);
    await office(app, "patch", `/api/emergency/incidents/${second.body.id}`).send({ reviewStatus: "dismissed" }).expect(404);
    await office(app, "post").send({ ...EVENT, companyId: "company-b" }).expect(400);
    await office(app, "post", "/api/emergency/incidents?companyId=company-b").send(EVENT).expect(400);
    const manual = await office(app, "post").send(EVENT);
    expect(manual.status).toBe(201);
    expect(manual.body.incident).toMatchObject({ sourceId: "_manual", ingestion: "manual", reviewStatus: "new" });
    expect((await office(app, "post").send(EVENT)).body.duplicate).toBe(true);
    setSession({ ...SESSION, companyId: "company-b" });
    const otherList = await office(app, "get");
    expect(otherList.body.incidents.map((incident) => incident.id)).toEqual([second.body.id]);
    expect([...db.store.values()].filter((record) => record.ingestion === "manual").map((record) => record.companyId)).toEqual(["company-a"]);
  });

  it.each(["0", "101", "-1", "1.5", "1e2", "050", "all", "5&limit=6", "50&companyId=company-b"])("rejects invalid limits and scope overrides: %s", async (limit) => {
    const { app, db } = testApp();
    await office(app, "get", `/api/emergency/incidents?limit=${limit}`).expect(400);
    expect(db.operations).toEqual([]);
  });

  it("bounds Firestore queries rather than fetching every incident", async () => {
    const { app, db } = testApp();
    await signed(app, { ...EVENT, eventId: "one" });
    await signed(app, { ...EVENT, eventId: "two" });
    const response = await office(app, "get", "/api/emergency/incidents?limit=1");
    expect(response.body.incidents).toHaveLength(1);
    expect(response.body.limit).toBe(1);
    expect(db.operations.at(-1)).toMatchObject({ type: "query", bound: 1, sort: ["receivedAt", "desc"] });
    await office(app, "get");
    expect(db.operations.at(-1).bound).toBe(50);
  });

  it("does not expose unexpected stored fields or corrupted tenant records", async () => {
    const { app, db } = testApp();
    await signed(app);
    const [path, record] = [...db.store][0];
    db.store.set(path, { ...record, secret: "private", homeownerName: "forbidden" });
    const listing = await office(app, "get");
    expect(listing.text).not.toContain("private");
    expect(listing.text).not.toContain("forbidden");
    expect(listing.body.incidents[0]).not.toHaveProperty("incidentHash");
    db.store.set(path, { ...record, companyId: "company-b" });
    expect((await office(app, "get")).body.incidents).toEqual([]);
  });

  it("patches only review fields and maintains linked-record consistency", async () => {
    const { app, db } = testApp();
    const created = await signed(app);
    const path = `/api/emergency/incidents/${created.body.id}`;
    for (const body of [{}, { reviewStatus: "done" }, { reviewStatus: "reviewing" }, { location: "Changed" }, { linkedRecordId: { id: "x" } }, { companyId: "company-b" }, { linkedRecordId: "../record" }, { reviewStatus: "linked" }]) {
      await office(app, "patch", path).send(body).expect(400);
    }
    const reviewed = await office(app, "patch", path).send({ reviewStatus: "reviewed", linkedRecordId: null }).expect(200);
    expect(reviewed.body.incident.reviewStatus).toBe("reviewed");
    expect([...db.store.values()][0].reviewStatus).toBe("reviewed");
    await seedDispatch(db, "DISPATCH-123", created.body.id);
    const linked = await office(app, "patch", path).send({ reviewStatus: "linked", linkedRecordId: "DISPATCH-123" });
    expect(linked.status).toBe(200);
    expect(linked.body.incident).toMatchObject({ reviewStatus: "linked", linkedRecordId: "DISPATCH-123" });
    await office(app, "patch", path).send({ linkedRecordId: null }).expect(409);
    await office(app, "patch", path).send({ reviewStatus: "reviewed", linkedRecordId: null }).expect(409);
    expect([...db.store.values()][0]).toMatchObject({ updatedByUid: SESSION.uid, reviewStatus: "linked", linkedRecordId: "DISPATCH-123" });
    await office(app, "patch", "/api/emergency/incidents/not-a-hash").send({ reviewStatus: "new" }).expect(400);
    await office(app, "patch", `/api/emergency/incidents/${"f".repeat(64)}`).send({ reviewStatus: "new" }).expect(404);
  });

  it.each(["new", "dismissed"])("rejects first linking from %s even with a valid dispatch target", async (reviewStatus) => {
    const { app, db } = testApp();
    const created = await signed(app);
    const path = `/api/emergency/incidents/${created.body.id}`;
    await seedDispatch(db, "dispatch-123", created.body.id);
    if (reviewStatus === "dismissed") await office(app, "patch", path).send({ reviewStatus }).expect(200);
    const writesBeforeLink = db.operations.filter((operation) => operation.type === "transactionWrite").length;
    await office(app, "patch", path).send({ reviewStatus: "linked", linkedRecordId: "dispatch-123" }).expect(409);
    expect([...db.store.values()][0]).toMatchObject({ reviewStatus, linkedRecordId: null });
    expect(db.operations.filter((operation) => operation.type === "transactionWrite")).toHaveLength(writesBeforeLink);
    expect(db.operations.some((operation) => operation.type === "query" && operation.path === "osWorkspaceRecords")).toBe(false);
    await office(app, "patch", path).send({ reviewStatus: "reviewed" }).expect(200);
    await office(app, "patch", path).send({ reviewStatus: "linked", linkedRecordId: "dispatch-123" }).expect(200);
  });

  it.each([
    { companyId: "company-b" }, { field: "files" }, { recordId: "different-record" }, { deletedAt: "2026-09-19T14:00:00Z" },
    { data: { id: "dispatch-123", moduleKey: "jobs", sourceIncidentId: "incident" } },
    { data: { id: "dispatch-123", moduleKey: "dispatch", sourceIncidentId: "different-incident" } },
    { data: { id: "dispatch-123", moduleKey: "dispatch" } }
  ])("rejects links outside the active company/dispatch/incident scope: %j", async (overrides) => {
    const { app, db } = testApp();
    const created = await signed(app);
    await seedDispatch(db, "dispatch-123", created.body.id, overrides);
    await office(app, "patch", `/api/emergency/incidents/${created.body.id}`).send({ reviewStatus: "reviewed" }).expect(200);
    await office(app, "patch", `/api/emergency/incidents/${created.body.id}`)
      .send({ reviewStatus: "linked", linkedRecordId: "dispatch-123" }).expect(400);
    expect([...db.store.values()][0].reviewStatus).toBe("reviewed");
  });

  it("rejects nonexistent and ambiguous dispatch targets", async () => {
    const { app, db } = testApp();
    const created = await signed(app);
    await office(app, "patch", `/api/emergency/incidents/${created.body.id}`).send({ reviewStatus: "reviewed" }).expect(200);
    const link = () => office(app, "patch", `/api/emergency/incidents/${created.body.id}`).send({ reviewStatus: "linked", linkedRecordId: "dispatch-123" });
    await link().expect(400);
    await seedDispatch(db, "dispatch-123", created.body.id);
    const target = db.store.get("osWorkspaceRecords/workspace-dispatch-123");
    await db.collection("osWorkspaceRecords").doc("other-workspace-document").set(target);
    await link().expect(400);
    expect([...db.store.values()][0].reviewStatus).toBe("reviewed");
  });

  it("makes linking immutable across racing requests while allowing an identical retry", async () => {
    const { app, db } = testApp();
    const created = await signed(app);
    await seedDispatch(db, "dispatch-one", created.body.id);
    await seedDispatch(db, "dispatch-two", created.body.id);
    const path = `/api/emergency/incidents/${created.body.id}`;
    await office(app, "patch", path).send({ reviewStatus: "reviewed" }).expect(200);
    const responses = await Promise.all(["dispatch-one", "dispatch-two"].map((id) => office(app, "patch", path).send({ reviewStatus: "linked", linkedRecordId: id })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningRecord = responses.find((response) => response.status === 200).body.incident;
    const writesBeforeRetry = db.operations.filter((operation) => operation.type === "transactionWrite").length;
    const retry = await office(app, "patch", path).send({ reviewStatus: "linked", linkedRecordId: winningRecord.linkedRecordId });
    expect(retry.status).toBe(200);
    expect(retry.body.incident).toEqual(winningRecord);
    expect(db.operations.filter((operation) => operation.type === "transactionWrite")).toHaveLength(writesBeforeRetry);
    expect(db.operations.filter((operation) => operation.type === "query" && operation.path === "osWorkspaceRecords")).toHaveLength(1);
  });

  it("rejects cross-site browser writes", async () => {
    const { app, db } = testApp();
    await office(app, "post").set("Sec-Fetch-Site", "cross-site").send(EVENT).expect(403);
    expect(db.store.size).toBe(0);
  });
});

async function firebaseRouterApp(user = SESSION) {
  vi.stubEnv("FIREBASE_OWNER_UID", "real-owner");
  vi.stubEnv("FIREBASE_OWNER_ONLY_LOGIN", "false");
  vi.stubEnv("EMERGENCY_FEEDS_JSON", JSON.stringify([SOURCE, OTHER_SOURCE]));
  const db = fakeFirestore();
  await db.collection("osUsers").doc(user.uid).set({ ...user, permissionsOverride: user.permissions });
  const auth = {
    verifySessionCookie: vi.fn(async (cookie) => {
      if (cookie !== "valid") throw new Error("invalid session");
      return { uid: user.uid, email: user.email, email_verified: true, firebase: { sign_in_provider: "google.com" } };
    }),
    getUser: async () => ({ uid: user.uid, email: user.email, displayName: "Test Owner" }),
    setCustomUserClaims: async () => undefined
  };
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  const { router } = createFirebaseRbacRouter({
    express,
    parseCookies: (header = "") => Object.fromEntries(header.split(";").filter(Boolean).map((entry) => entry.trim().split("="))),
    jsonError: (res, status, message) => res.status(status).json({ success: false, message }),
    getFirebaseAuth: () => auth,
    getFirebasePublicConfig: () => ({ configured: true, adminConfigured: true }),
    getFirebaseStorageBucket: () => null,
    getFirestore: () => db,
    isFirebaseConfigured: () => true
  });
  app.use(router);
  return { app, db, auth };
}

describe("existing Firebase router integration", () => {
  it("uses requireSession and the existing effective permission/application visibility helpers", async () => {
    const { app, auth } = await firebaseRouterApp();
    await request(app).get("/api/emergency/status").expect(401);
    await request(app).get("/api/emergency/status").set("Cookie", "brothers_os_session=invalid").expect(401);
    const response = await request(app).get("/api/emergency/status").set("Cookie", "brothers_os_session=valid");
    expect(response.status).toBe(200);
    expect(response.body.sources.map((source) => source.id)).toEqual([SOURCE.id]);
    expect(auth.verifySessionCookie).toHaveBeenCalledWith("valid", true);
  });

  it.each([
    { roleId: "worker" }, { roleId: "contractor" }, { roleId: "franchise_owner" }, { roleId: "super_admin" },
    { visiblePageIds: ["jobs"], visibleTabIds: ["jobs"] },
    { permissions: { pages: { mode: "selected", allowed: ["jobs"], hidden: [] } } },
    { permissions: { pages: { mode: "all", hidden: ["dispatch"] } } },
    { disabled: true }
  ])("denies forbidden role/visibility through the actual Firebase router: %j", async (patch) => {
    const { app } = await firebaseRouterApp({ ...SESSION, ...patch });
    await request(app).get("/api/emergency/status").set("Cookie", "brothers_os_session=valid").expect(403);
  });

  it("accepts only the configured owner identity as super_admin", async () => {
    const { app } = await firebaseRouterApp({ ...SESSION, uid: "real-owner", email: "david@brothersrestoration.org", roleId: "super_admin" });
    await request(app).get("/api/emergency/status").set("Cookie", "brothers_os_session=valid").expect(200);
    const mismatch = await firebaseRouterApp({ ...SESSION, uid: "wrong-owner", email: "david@brothersrestoration.org", roleId: "super_admin" });
    await request(mismatch.app).get("/api/emergency/status").set("Cookie", "brothers_os_session=valid").expect(403);
  });
});
