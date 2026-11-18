import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { normalizeManualTimeEntry } from "../manual-time.js";
import { equipmentRecordScope } from "../equipment-lifecycle.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const implementation = source.slice(source.indexOf("async function addManualTime("), source.indexOf("function renderClockSession("));
const job = { id: "job-a", jobId: "J-100", companyId: "company-a", branchId: "branch-a", contractorId: "" };

function runtime({ jobs = [job], memberContractor = "", sync = async () => ({ durable: true }) } = {}) {
  const state = { timeEntries: [], files: [], authSession: { uid: "owner", email: "owner@example.com" } };
  const events = [];
  const context = vm.createContext({
    Date, state, equipmentRecordScope, normalizeManualTimeEntry,
    currentRoleId: () => "super_admin",
    assignableTeamMembers: () => [{ id: "employee", name: "Employee", email: "employee@example.com", contractorId: memberContractor }],
    visibleJobBoards: () => jobs,
    createId: () => "time-1",
    createFile: (data, options) => { events.push(options); state.files.push(data); return data; },
    addActivity: () => {}, persist: () => {}, render: () => {},
    syncWorkspaceState: sync,
    hydrateWorkspaceState: async () => { events.push("hydrate"); return true; },
    setToast: (message) => events.push(message)
  });
  vm.runInContext(implementation, context);
  const form = new FormData();
  Object.entries({ workerId: "employee", job: "job-a", task: "Extraction", start: "2026-01-01T09:00", end: "2026-01-01T11:00", breakMinutes: "30", notes: "Office correction", billable: "on" }).forEach(([key, value]) => form.set(key, value));
  return { context, state, events, form };
}

describe("manual time UI to workspace contract", () => {
  it("preserves branch-only job scope without inventing a franchise and links the support file", async () => {
    const { context, state, events, form } = runtime();
    await context.addManualTime(form);
    expect(state.timeEntries[0]).toMatchObject({ jobId: job.id, job: job.jobId, relatedJob: job.jobId, branchId: job.branchId, franchiseId: "", companyId: job.companyId, hours: "1.50" });
    expect(state.files[0]).toMatchObject({ jobId: job.id, relatedJob: job.jobId, branchId: job.branchId, companyId: job.companyId, sourceId: "time-1" });
    expect(state.files[0].linkedModuleKeys).toEqual(["jobs", "payments", "reports", "closeout"]);
    expect(events[0]).toEqual({ announce: false });
  });

  it("selects the persisted ID even when contractor job numbers are duplicated", async () => {
    const { context, state, form } = runtime({ jobs: [{ ...job, id: "job-other", contractorId: "other" }, job] });
    await context.addManualTime(form);
    expect(state.timeEntries[0].jobId).toBe("job-a");
    expect(state.timeEntries[0].contractorId).toBe("");
  });

  it("rejects a mismatched contractor before changing local records", async () => {
    const { context, state, form } = runtime({ memberContractor: "different-contractor" });
    await expect(context.addManualTime(form)).rejects.toThrow("same contractor");
    expect(state.timeEntries).toHaveLength(0);
    expect(state.files).toHaveLength(0);
  });

  it("does not report success or hydrate on a rejected save", async () => {
    const { context, events, form } = runtime({ sync: async () => { throw new Error("Storage unavailable"); } });
    await expect(context.addManualTime(form)).rejects.toThrow("Storage unavailable");
    expect(events).toEqual([{ announce: false }]);
  });
});
