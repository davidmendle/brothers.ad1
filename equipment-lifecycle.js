const officeRoles = new Set(["super_admin", "business_owner", "franchise_owner"]);
const scopeFields = ["companyId", "franchiseId", "branchId", "contractorId"];
const fieldRoles = new Set(["worker", "contractor"]);

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`);
  return value.trim();
}

function timestamp(value, label) {
  const input = requiredText(value, label);
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  const ms = Date.parse(input);
  if (!parts || !Number.isFinite(ms)) fail(`${label} must include a valid date, time, and time zone.`);
  const [, day, hour, minute, second = "0", zone] = parts;
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    fail(`${label} is invalid.`);
  }
  return ms;
}

function assertActor(actor) {
  if (!officeRoles.has(actor.roleId) && !fieldRoles.has(actor.roleId)) fail("Equipment access is required.", 403);
  requiredText(actor.uid, "Current user");
}

export function canManageEquipmentBilling(roleId) {
  return officeRoles.has(roleId);
}

export function equipmentRecordScope(record) {
  return Object.fromEntries(scopeFields.filter((key) => record[key] != null).map((key) => [key, record[key]]));
}

export function sameEquipmentScope(left, right) {
  return scopeFields.every((key) => String(left[key] || "").trim() === String(right[key] || "").trim());
}

export function isEquipmentActive(deployment) {
  return !["returned", "picked up", "cancelled"].includes(String(deployment.status || "").trim().toLowerCase());
}

export function findActiveEquipmentConflict(deployments, candidate) {
  const asset = requiredText(candidate.assetTag, "Asset tag").replace(/\s+/g, " ").toLowerCase();
  return deployments.find((item) => isEquipmentActive(item)
    && String(item.assetTag || "").trim().replace(/\s+/g, " ").toLowerCase() === asset
    // Location changes do not make an asset available; contractor-owned inventories remain separate.
    && ["companyId", "contractorId"].every((key) => String(item[key] || "") === String(candidate[key] || "")));
}

export function equipmentRentalDays(deployedAt, returnedAt) {
  const duration = timestamp(returnedAt, "Return time") - timestamp(deployedAt, "Deployment time");
  if (duration < 0) fail("Return time cannot be before deployment time.");
  return Math.max(1, Math.ceil(duration / 86400000));
}

export function normalizeEquipmentBilling(deployment, changes, actor, now = new Date().toISOString()) {
  assertActor(actor);
  if (!canManageEquipmentBilling(actor.roleId)) fail("Only office administrators can change equipment billing.", 403);
  if (typeof changes.billable !== "boolean") fail("Billable must be true or false.");
  const raw = changes.dailyRate;
  if (!["string", "number"].includes(typeof raw)
    || (typeof raw === "string" && !/^\d+(?:\.\d{1,2})?$/.test(raw.trim()))) fail("Daily rate must be a nonnegative amount with at most two decimals.");
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1000000 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001) fail("Daily rate is invalid.");
  if (changes.billable && rate === 0) fail("Billable equipment requires a positive daily rate.");
  return {
    ...deployment,
    billable: changes.billable,
    dailyRate: rate,
    invoiceNumber: String(changes.invoiceNumber || "").trim(),
    billingReviewedAt: new Date(timestamp(now, "Current time")).toISOString(),
    billingReviewedByUid: actor.uid,
    updatedAt: now
  };
}

// The caller must resolve job membership and scope using trusted workspace records.
export function normalizeEquipmentDeployment(record, actor, deployments = [], now = new Date().toISOString()) {
  assertActor(actor);
  const placed = timestamp(record.deployedAt, "Deployment time");
  const current = timestamp(now, "Current time");
  if (placed > current + 60000) fail("Deployment time cannot be in the future.");
  if (record.status && record.status !== "Deployed") fail("New equipment must start as Deployed.");
  if (record.returnedAt || record.invoiceId || Number(record.rentalDays || 0) !== 0) fail("A new deployment cannot contain a return, invoice, or billed duration.");
  let result = {
    ...equipmentRecordScope(record),
    id: requiredText(record.id, "Deployment ID"),
    lifecycleVersion: 1,
    equipmentName: requiredText(record.equipmentName, "Equipment name"),
    assetTag: requiredText(record.assetTag, "Asset tag"),
    jobId: requiredText(record.jobId, "Assigned job"),
    job: requiredText(record.job, "Job"),
    deployedAt: new Date(placed).toISOString(),
    returnedAt: "",
    status: "Deployed",
    rentalDays: 0,
    dailyRate: 0,
    billable: false,
    invoiceId: "",
    invoiceNumber: "",
    createdAt: now,
    updatedAt: now,
    deployedByUid: actor.uid
  };
  for (const key of ["room", "address", "notes", "gpsLabel"]) result[key] = String(record[key] || "").trim();
  for (const [key, limit] of [["latitude", 90], ["longitude", 180]]) {
    const value = record[key];
    result[key] = value == null || value === "" ? null : Number(value);
    if (result[key] != null && (!Number.isFinite(result[key]) || Math.abs(result[key]) > limit)) fail(`${key} is invalid.`);
  }
  if ((result.latitude == null) !== (result.longitude == null)) fail("Enter both latitude and longitude, or leave both blank.");
  if (canManageEquipmentBilling(actor.roleId)) {
    result = normalizeEquipmentBilling(result, record, actor, now);
  } else if ((record.billable != null && record.billable !== false) || Number(record.dailyRate || 0) !== 0 || record.invoiceNumber) {
    fail("Field users cannot set equipment rates or invoice details.", 403);
  }
  const conflict = findActiveEquipmentConflict(deployments, result);
  if (conflict) fail(`Asset ${result.assetTag} is already active on ${conflict.job || conflict.id}. Record its return first.`, 409);
  return result;
}

export function returnEquipmentDeployment(deployment, changes, actor, now = new Date().toISOString()) {
  assertActor(actor);
  const returned = timestamp(changes.returnedAt, "Return time");
  if (returned > timestamp(now, "Current time") + 60000) fail("Return time cannot be in the future.");
  if (!isEquipmentActive(deployment)) {
    if (deployment.returnedAt && timestamp(deployment.returnedAt, "Return time") === returned) return { ...deployment };
    fail("This deployment has already been returned or cancelled.", 409);
  }
  const deployedAt = deployment.deployedAt || deployment.createdAt;
  const rentalDays = equipmentRentalDays(deployedAt, changes.returnedAt);
  return {
    ...deployment,
    lifecycleVersion: 1,
    deployedAt: new Date(timestamp(deployedAt, "Deployment time")).toISOString(),
    returnedAt: new Date(returned).toISOString(),
    rentalDays,
    status: "Returned",
    returnNotes: String(changes.returnNotes || "").trim(),
    returnedByUid: actor.uid,
    updatedAt: now
  };
}

export function equipmentMatchesJob(deployment, job) {
  if (!sameEquipmentScope(deployment, job)) return false;
  const references = [job.id, job.jobId, job.title, `${job.jobId || ""} ${job.title || ""}`]
    .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  return references.includes(String(deployment.jobId || deployment.job || "").trim().toLowerCase());
}

export function equipmentJobGate(job, deployments) {
  const linked = deployments.filter((deployment) => equipmentMatchesJob(deployment, job));
  if (!linked.length) return job;
  const status = linked.some(isEquipmentActive) ? "Open" : "Done";
  return { ...job, gates: (job.gates || []).map((gate) => gate.id === "equipment" ? { ...gate, status } : gate) };
}
