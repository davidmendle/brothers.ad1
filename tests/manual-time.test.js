import { describe, expect, it } from "vitest";
import { normalizeManualTimeEntry } from "../manual-time.js";

const now = "2026-09-20T18:00:00.000Z";
const actor = { roleId: "business_owner", uid: "office-1", email: "OFFICE@example.com" };
const entry = {
  id: "time-1", entryMethod: "manual", workerId: "worker-1", workerEmail: "worker@example.com",
  worker: " Worker One ", job: "job-1", taskId: "task-1", task: "Water extraction", billable: true,
  start: "2026-09-19T09:00:00-04:00", end: "2026-09-19T17:00:00-04:00", breakMinutes: "30",
  notes: " Office correction approved by supervisor. ", contractorId: "contractor-1"
};
const normalize = (change = {}, who = actor) => normalizeManualTimeEntry({ ...entry, ...change }, who, now);
const rejects = (operation, statusCode = 400) => {
  try { operation(); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(statusCode);
    return;
  }
  throw new Error("Expected validation to reject the entry");
};

describe("office-entered manual time", () => {
  it.each(["super_admin", "business_owner", "franchise_owner"])("allows %s and derives hours and audit", (roleId) => {
    expect(normalize({}, { ...actor, roleId })).toMatchObject({
      id: "time-1", worker: "Worker One", start: "2026-09-19T13:00:00.000Z", end: "2026-09-19T21:00:00.000Z",
      hours: "7.50", breakMinutes: 30, startGps: null, endGps: null, enteredByUid: actor.uid,
      enteredByEmail: "office@example.com", enteredAt: now
    });
  });
  it.each(["worker", "contractor", "", "SUPER_ADMIN"])("rejects actor %s", (roleId) => {
    rejects(() => normalize({}, { ...actor, roleId }), 403);
  });
  it("discards forged hours, GPS, audit, role and unknown fields without mutating input", () => {
    const raw = { ...entry, hours: "900", startGps: { latitude: 1 }, enteredByUid: "forged", enteredAt: "forged", updatedAt: now, roleId: "super_admin", extra: "drop" };
    const result = normalizeManualTimeEntry(raw, actor, now);
    expect(result.hours).toBe("7.50");
    expect(result.startGps).toBeNull();
    expect(result.enteredByUid).toBe(actor.uid);
    expect(result).not.toHaveProperty("updatedAt");
    expect(result).not.toHaveProperty("extra");
    expect(result).not.toHaveProperty("roleId");
    expect(raw.hours).toBe("900");
  });
  it.each(["workerId", "worker", "job", "task", "notes", "start", "end"])("requires %s", (key) => rejects(() => normalize({ [key]: " " })));
  it.each([
    { start: "not a date" }, { start: "2026-09-19" }, { start: "2026-09-19T09:00:00" },
    { start: "2026-02-30T09:00:00Z" }, { start: "2026-09-19T24:00:00Z" }, { start: "2026-09-19T09:60:00Z" },
    { end: entry.start }, { end: "2026-09-19T08:00:00-04:00" }, { end: "2026-09-20T09:00:01-04:00" },
    { start: "2026-09-20T18:01:01Z", end: "2026-09-20T18:02:00Z" },
    { start: "2026-09-20T17:00:00Z", end: "2026-09-20T18:01:01Z" }
  ])("rejects invalid dates or duration %j", (change) => rejects(() => normalize(change)));
  it("accepts 24 hours and one minute of clock skew at the boundary", () => {
    expect(normalize({ start: "2026-09-19T18:01:00Z", end: "2026-09-20T18:01:00Z", breakMinutes: 0 }).hours).toBe("24.00");
  });
  it.each([-1, 480, 481, Infinity, NaN, true, {}, "garbage", "", "0x10"])("rejects break %j", (breakMinutes) => rejects(() => normalize({ breakMinutes })));
  it("rounds net duration, including fractional break minutes, to two decimals", () => {
    expect(normalize({ end: "2026-09-19T13:20:00Z", breakMinutes: 0.5 }).hours).toBe("0.33");
    expect(normalize({ breakMinutes: undefined, taskId: undefined, workerEmail: undefined }).hours).toBe("8.00");
  });
  it.each([{ billable: "false" }, { notes: "x".repeat(2001) }, { workerId: {} }, { workerEmail: "invalid" }, { entryMethod: "gps" }])("rejects malformed field %j", (change) => rejects(() => normalize(change)));
  it("requires a server actor identity and clock", () => {
    rejects(() => normalize({}, { ...actor, uid: "" }));
    rejects(() => normalizeManualTimeEntry(entry, actor, "invalid"));
  });
});
