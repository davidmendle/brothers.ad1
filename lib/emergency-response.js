const crypto = require("node:crypto");

const MAX_BODY_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const INCIDENT_TYPES = ["fire", "water", "storm", "rescue", "hazardous_material", "other"];
const REVIEW_STATUSES = ["new", "reviewed", "linked", "dismissed"];
const INCIDENT_FIELDS = ["id", "eventId", "type", "location", "occurredAt", "units", "summary", "sourceUrl"];
const PUBLIC_FIELDS = [
  "eventId", "type", "location", "occurredAt", "units", "summary", "sourceUrl",
  "sourceId", "sourceLabel", "area", "ingestion", "reviewStatus", "linkedRecordId",
  "receivedAt", "createdAt", "updatedAt"
];

class EmergencyError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function reject(statusCode, message) {
  throw new EmergencyError(statusCode, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function onlyFields(value, fields) {
  if (!isObject(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    reject(400, "Only the documented incident fields are accepted.");
  }
}

function textField(value, name, max, { empty = false } = {}) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())
    || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) {
    reject(400, `${name} must be ${empty ? "a" : "a non-empty"} string of at most ${max} characters.`);
  }
  return value.trim();
}

function safePublicUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || value !== value.trim()
    || /[\s\\\u0000-\u001f\u007f]/.test(value) || !value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch (_error) {
    return null;
  }
}

function validCompanyId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value === value.trim() && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

function readSources(env) {
  const raw = env.EMERGENCY_FEEDS_JSON;
  if (raw === undefined || raw === "") return [];
  try {
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 64 * 1024) throw new Error();
    const sources = JSON.parse(raw);
    if (!Array.isArray(sources) || sources.length > 100) throw new Error();
    const ids = new Set();
    const secrets = new Set();
    return sources.map((source) => {
      onlyFields(source, ["id", "label", "area", "companyId", "secret", "streamUrl"]);
      if (typeof source.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(source.id)
        || ids.has(source.id) || !validCompanyId(source.companyId)
        || typeof source.secret !== "string" || Buffer.byteLength(source.secret) < 32
        || Buffer.byteLength(source.secret) > 512 || /\s/.test(source.secret) || secrets.has(source.secret)) throw new Error();
      ids.add(source.id);
      secrets.add(source.secret);
      const label = textField(source.label, "label", 160);
      const area = textField(source.area, "area", 160);
      const streamUrl = source.streamUrl === undefined ? null : safePublicUrl(source.streamUrl);
      if (source.streamUrl !== undefined && !streamUrl) throw new Error();
      return { id: source.id, label, area, companyId: source.companyId, secret: source.secret, streamUrl };
    });
  } catch (_error) {
    reject(503, "Emergency feed configuration is invalid.");
  }
}

function validateIncident(payload) {
  onlyFields(payload, INCIDENT_FIELDS);
  const eventId = textField(payload.eventId ?? payload.id, "eventId", 160);
  if (payload.id !== undefined && textField(payload.id, "id", 160) !== eventId) {
    reject(400, "id and eventId must match when both are supplied.");
  }
  if (payload.eventId === null || !INCIDENT_TYPES.includes(payload.type)) reject(400, "A valid eventId and incident type are required.");
  const occurredAt = textField(payload.occurredAt, "occurredAt", 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(occurredAt)
    || !Number.isFinite(Date.parse(occurredAt))
    || new Date(occurredAt).toISOString() !== (occurredAt.length === 20 ? occurredAt.replace("Z", ".000Z") : occurredAt)) {
    reject(400, "occurredAt must be a real UTC ISO timestamp (YYYY-MM-DDTHH:mm:ss[.sss]Z).");
  }
  const units = payload.units === undefined ? [] : payload.units;
  if (!Array.isArray(units) || units.length > 50) reject(400, "units must be an array of at most 50 unit identifiers.");
  const sourceUrl = payload.sourceUrl === undefined ? null : safePublicUrl(payload.sourceUrl);
  if (payload.sourceUrl !== undefined && !sourceUrl) reject(400, "sourceUrl must be public HTTPS without credentials, query, or fragment.");
  return {
    eventId,
    type: payload.type,
    location: textField(payload.location, "location", 500),
    occurredAt: new Date(occurredAt).toISOString(),
    units: units.map((unit) => textField(unit, "unit", 80)),
    summary: payload.summary === undefined ? "" : textField(payload.summary, "summary", 2000, { empty: true }),
    sourceUrl
  };
}

function checkBody(request, { rawRequired = false } = {}) {
  if (!request.is("application/json") || (request.get("content-encoding") || "identity").toLowerCase() !== "identity") {
    reject(415, "Use uncompressed application/json.");
  }
  const charset = /;\s*charset\s*=\s*([^;]+)/i.exec(request.get("content-type") || "");
  if (charset && !/^"?utf-8"?$/i.test(charset[1].trim())) reject(415, "JSON must use UTF-8.");
  if (rawRequired && !Buffer.isBuffer(request.rawBody)) reject(503, "Emergency webhook raw-body capture is unavailable.");
  if ((Buffer.isBuffer(request.rawBody) && request.rawBody.length > MAX_BODY_BYTES)
    || Buffer.byteLength(JSON.stringify(request.body) || "") > MAX_BODY_BYTES) reject(413, "Incident payload exceeds 32 KiB.");
}

function verifySignature(request, source, now) {
  const timestamp = request.get("x-emergency-timestamp");
  const signature = request.get("x-emergency-signature");
  if (typeof timestamp !== "string" || !/^[1-9]\d{9}$/.test(timestamp)
    || typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
    || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    reject(401, "Invalid emergency webhook authentication.");
  }
  const expected = crypto.createHmac("sha256", source.secret).update(timestamp).update(".").update(request.rawBody).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) {
    reject(401, "Invalid emergency webhook authentication.");
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function companyIncidents(db, companyId) {
  return db.collection("osEmergencyCompanies").doc(hash(companyId)).collection("incidents");
}

function publicIncident(id, data) {
  return { id, ...Object.fromEntries(PUBLIC_FIELDS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]])) };
}

async function insertIncident(db, companyId, source, incident, actorUid, now) {
  const id = hash(JSON.stringify([source.id, incident.eventId]));
  const ref = companyIncidents(db, companyId).doc(id);
  const incidentHash = hash(JSON.stringify(incident));
  const timestamp = new Date(now).toISOString();
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const stored = existing.data();
      if (stored.companyId !== companyId || stored.incidentHash !== incidentHash) {
        reject(409, "This source event ID already exists with different incident data.");
      }
      return { id, duplicate: true, incident: publicIncident(id, stored) };
    }
    const record = {
      ...incident,
      companyId,
      sourceId: source.id,
      sourceLabel: source.label,
      area: source.area,
      ingestion: actorUid ? "manual" : "webhook",
      incidentHash,
      reviewStatus: "new",
      linkedRecordId: null,
      receivedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUid: actorUid || null,
      updatedByUid: actorUid || null
    };
    transaction.set(ref, record);
    return { id, duplicate: false, incident: publicIncident(id, record) };
  });
}

function mountEmergencyResponseRoutes({ router, requireSession, getFirestore, isOwnerIdentity, canAccessDispatch, env = process.env, now = Date.now }) {
  function datastore() {
    const db = getFirestore();
    if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
      reject(503, "Emergency incident storage is unavailable.");
    }
    return db;
  }

  function endpoint(handler) {
    return async (request, response) => {
      response.set("Cache-Control", "no-store");
      try {
        await handler(request, response);
      } catch (error) {
        const known = error instanceof EmergencyError;
        response.status(known ? error.statusCode : 503).json({
          success: false,
          message: known ? error.message : "Emergency incident storage is unavailable."
        });
      }
    };
  }

  function office(handler) {
    return [requireSession, endpoint(async (request, response) => {
      const session = request.osSession;
      const eligibleRole = session?.roleId === "business_owner"
        || (session?.roleId === "super_admin" && isOwnerIdentity(session.uid, session.email));
      if (!session?.uid || session.disabled || !eligibleRole || !validCompanyId(session.companyId) || !canAccessDispatch(session)) {
        reject(403, "Emergency incidents require owner access to dispatch and a valid company assignment.");
      }
      if (!["GET", "HEAD"].includes(request.method) && request.get("sec-fetch-site") === "cross-site") {
        reject(403, "Cross-site incident writes are not allowed.");
      }
      await handler(request, response, session);
    })];
  }

  router.post("/api/emergency/webhooks/:sourceId", endpoint(async (request, response) => {
    onlyFields(request.query, []);
    checkBody(request, { rawRequired: true });
    const source = readSources(env).find((entry) => entry.id === request.params.sourceId);
    if (!source) reject(401, "Invalid emergency webhook authentication.");
    verifySignature(request, source, now());
    let payload;
    try {
      // Authenticate and parse the same bytes, never a transformed request.body.
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(request.rawBody));
    } catch (_error) {
      reject(400, "Invalid incident JSON.");
    }
    const incident = validateIncident(payload);
    const result = await insertIncident(datastore(), source.companyId, source, incident, null, now());
    response.status(result.duplicate ? 200 : 201).json({ success: true, id: result.id, duplicate: result.duplicate });
  }));

  router.get("/api/emergency/status", ...office(async (request, response, session) => {
    onlyFields(request.query, []);
    let configurationValid = true;
    let sources = [];
    try {
      sources = readSources(env).filter((source) => source.companyId === session.companyId)
        .map(({ id, label, area, streamUrl }) => ({ id, label, area, streamUrl }));
    } catch (_error) {
      configurationValid = false;
    }
    let available = false;
    try {
      await companyIncidents(datastore(), session.companyId).limit(1).get();
      available = true;
    } catch (_error) { /* Status reports storage failure without inventing feed health. */ }
    response.json({
      success: true,
      configured: configurationValid && sources.length > 0,
      configurationValid,
      sources,
      runtime: { storage: "firestore", available, reason: available ? null : "storage_unavailable" },
      webhookReady: configurationValid && sources.length > 0 && available,
      incidentTypes: INCIDENT_TYPES,
      reviewStatuses: REVIEW_STATUSES,
      limits: { payloadBytes: MAX_BODY_BYTES, maxIncidents: 100, timestampSkewSeconds: MAX_CLOCK_SKEW_SECONDS }
    });
  }));

  router.get("/api/emergency/incidents", ...office(async (request, response, session) => {
    onlyFields(request.query, ["limit"]);
    const input = request.query.limit;
    if (input !== undefined && (typeof input !== "string" || !/^(?:[1-9]\d?|100)$/.test(input))) {
      reject(400, "limit must be an integer from 1 to 100.");
    }
    const limit = input === undefined ? 50 : Number(input);
    const snapshot = await companyIncidents(datastore(), session.companyId).orderBy("receivedAt", "desc").limit(limit).get();
    const incidents = snapshot.docs.filter((doc) => doc.data().companyId === session.companyId)
      .map((doc) => publicIncident(doc.id, doc.data()));
    response.json({ success: true, incidents, limit });
  }));

  router.post("/api/emergency/incidents", ...office(async (request, response, session) => {
    onlyFields(request.query, []);
    checkBody(request);
    const incident = validateIncident(request.body);
    const result = await insertIncident(datastore(), session.companyId, { id: "_manual", label: "Manual entry", area: "" }, incident, session.uid, now());
    response.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
  }));

  router.patch("/api/emergency/incidents/:id", ...office(async (request, response, session) => {
    onlyFields(request.query, []);
    checkBody(request);
    onlyFields(request.body, ["reviewStatus", "linkedRecordId"]);
    if (!/^[a-f0-9]{64}$/.test(request.params.id)) reject(400, "Invalid incident ID.");
    const updates = {};
    if (Object.hasOwn(request.body, "reviewStatus")) {
      if (!REVIEW_STATUSES.includes(request.body.reviewStatus)) reject(400, "Invalid reviewStatus.");
      updates.reviewStatus = request.body.reviewStatus;
    }
    if (Object.hasOwn(request.body, "linkedRecordId")) {
      const linkedRecordId = request.body.linkedRecordId;
      if (linkedRecordId !== null && (typeof linkedRecordId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(linkedRecordId))) {
        reject(400, "linkedRecordId must be a record identifier or null.");
      }
      updates.linkedRecordId = linkedRecordId;
    }
    if (!Object.keys(updates).length) reject(400, "Supply reviewStatus or linkedRecordId.");
    const db = datastore();
    const ref = companyIncidents(db, session.companyId).doc(request.params.id);
    const incident = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().companyId !== session.companyId) reject(404, "Incident not found.");
      const current = snapshot.data();
      const record = { ...current, ...updates, updatedAt: new Date(now()).toISOString(), updatedByUid: session.uid };
      if (current.reviewStatus === "linked") {
        if (record.reviewStatus !== "linked" || record.linkedRecordId !== current.linkedRecordId) {
          reject(409, "This incident is already linked. Its linked record and status are immutable.");
        }
        return publicIncident(ref.id, current);
      }
      if (record.reviewStatus === "linked" && !record.linkedRecordId) reject(400, "A linked incident requires linkedRecordId.");
      if (record.reviewStatus === "linked" && current.reviewStatus !== "reviewed") {
        reject(409, "Complete human review and mark the incident reviewed before linking.");
      }
      if (record.linkedRecordId) {
        if (record.reviewStatus !== "linked") reject(400, "Supply reviewStatus linked with linkedRecordId.");
        // Query and incident read share the transaction so deletion or relinking cannot race validation.
        const targets = await transaction.get(db.collection("osWorkspaceRecords")
          .where("companyId", "==", session.companyId)
          .where("field", "==", "moduleRecords")
          .where("recordId", "==", record.linkedRecordId)
          .where("deletedAt", "==", "")
          .limit(2));
        const target = targets.docs.length === 1 ? targets.docs[0].data() : null;
        if (!target || target.companyId !== session.companyId || target.field !== "moduleRecords"
          || target.recordId !== record.linkedRecordId || target.deletedAt
          || target.data?.id !== record.linkedRecordId || target.data?.moduleKey !== "dispatch"
          || target.data?.sourceIncidentId !== ref.id) {
          reject(400, "linkedRecordId must identify one active dispatch module record for this company and incident.");
        }
      }
      transaction.set(ref, record);
      return publicIncident(ref.id, record);
    });
    response.json({ success: true, incident });
  }));
}

module.exports = { mountEmergencyResponseRoutes };
