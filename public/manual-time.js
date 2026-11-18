const officeRoles = new Set(["super_admin", "business_owner", "franchise_owner"]);

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function text(value, label, maxLength, required = false) {
  if (value != null && typeof value !== "string") fail(`${label} must be text.`);
  const result = (value || "").trim();
  if (required && !result) fail(`${label} is required.`);
  if (result.length > maxLength) fail(`${label} is too long (maximum ${maxLength} characters).`);
  return result;
}

function isoTime(value, label) {
  const input = text(value, label, 40, true);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!parts) fail(`${label} must be an ISO date and time with a time zone.`);
  const [, year, month, day, hour, minute, second = "0", , zone] = parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp) || !Number.isFinite(calendar.getTime())
    || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    fail(`${label} must be a valid date and time.`);
  }
  return timestamp;
}

// The router resolves employee membership and scope; this helper validates only the entry itself.
export function normalizeManualTimeEntry(record, actor = {}, nowISOString = new Date().toISOString()) {
  if (!officeRoles.has(actor.roleId)) fail("Only an office administrator can enter manual time.", 403);
  if (!record || typeof record !== "object" || Array.isArray(record)) fail("A manual time entry is required.");
  if (record.entryMethod !== "manual") fail("Manual time must use entryMethod 'manual'.");
  const enteredByUid = text(actor.uid, "The entering administrator's ID", 256, true);
  const enteredByEmail = text(actor.email, "The entering administrator's email", 320, true).toLowerCase();
  const now = isoTime(nowISOString, "Server time");
  const start = isoTime(record.start, "Start time");
  const end = isoTime(record.end, "End time");
  const duration = end - start;
  if (duration <= 0 || duration > 86400000) fail("End time must be after start time, with a shift no longer than 24 hours.");
  if (start > now + 60000 || end > now + 60000) fail("Manual time cannot be entered in the future.");
  const rawBreak = record.breakMinutes ?? 0;
  if (!["string", "number"].includes(typeof rawBreak)
    || (typeof rawBreak === "string" && !/^\d+(?:\.\d+)?$/.test(rawBreak.trim()))) {
    fail("Break minutes must be a nonnegative number.");
  }
  const breakMinutes = Number(rawBreak);
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes * 60000 >= duration) {
    fail("Break minutes must be nonnegative and shorter than the shift.");
  }
  if (record.billable != null && typeof record.billable !== "boolean") fail("Billable must be true or false.");
  const workerEmail = text(record.workerEmail, "Worker email", 320).toLowerCase();
  if (workerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workerEmail)) fail("Worker email is invalid.");
  const result = {
    entryMethod: "manual",
    workerId: text(record.workerId, "Worker ID", 256, true),
    workerEmail,
    worker: text(record.worker, "Worker name", 200, true),
    job: text(record.job, "Job", 300, true),
    taskId: text(record.taskId, "Task ID", 256),
    task: text(record.task, "Task", 300, true),
    billable: record.billable ?? false,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    breakMinutes,
    notes: text(record.notes, "Reason for manual entry", 2000, true),
    hours: ((duration - breakMinutes * 60000) / 3600000).toFixed(2),
    startGps: null,
    endGps: null,
    enteredByUid,
    enteredByEmail,
    enteredAt: new Date(now).toISOString()
  };
  for (const key of ["id", "companyId", "franchiseId", "branchId", "contractorId", "jobId", "relatedJob"]) {
    if (record[key] != null) result[key] = text(record[key], key, 300);
  }
  return result;
}
