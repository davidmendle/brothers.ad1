import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

// Execute the actual browser functions without starting the DOM or contacting a backend.
function implementation(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`Missing application function: ${name}`);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:async )?function \w+\(/m);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function runtime(overrides = {}) {
  const state = {
    authSession: { uid: "owner-a", email: "owner-a@example.com", companyId: "company-a" },
    firebase: { enabled: true }, accessContext: { users: [], accessGrants: [] },
    tasks: [], files: [], teamMembers: [], modal: { type: "pending-employee-manage" }
  };
  const events = [];
  const moduleKeys = ["jobs", "photos", "time", "equipment", "communications", "payments"];
  const context = vm.createContext({
    Date, Set, Map, state, events,
    modules: moduleKeys.map((key) => ({ key, label: key })),
    employeeAllowedModuleKeys: moduleKeys.filter((key) => key !== "payments"),
    defaultContractorModuleKeys: moduleKeys,
    moduleByKey: (key) => moduleKeys.includes(key) ? { key, label: key } : null,
    moduleKeysFromList: (value) => (Array.isArray(value) ? value : []).filter((key) => moduleKeys.includes(key)),
    normalizeListValue: (value) => Array.isArray(value) ? value : String(value || "").split(",").filter(Boolean),
    normalizePriceToken: (value) => value,
    currentRoleId: () => "super_admin", currentSessionUser: () => state.authSession,
    canDo: () => true, csvValues: (value) => String(value || "").split(",").filter(Boolean),
    applicationIdsForModuleKeys: (keys) => keys.length ? ["field"] : [],
    apiRequest: async (path, options) => { events.push({ path, ...options }); return {}; },
    upsertAccessGrant: (grant) => { events.push({ grant }); },
    refreshAccessContext: async () => { events.push("refresh"); },
    setToast: (message) => { events.push(message); }, render: () => { events.push("render"); },
    ...overrides
  });
  for (const name of ["defaultModuleAccessForRole", "visibleModuleKeysForMember", "normalizeTeamMember",
    "mapUserToTeamMember", "mapEmployeeGrantToTeamMember", "employeeDirectoryMembers", "assignableTeamMembers",
    "currentContractorId", "currentEmployerContractorId", "employeeEmployerOptions", "createEmployeeInvitation",
    "updatePendingEmployeeInvitation", "refreshTeamAfterSave", "savePendingEmployeeInvitation", "revokePendingEmployeeInvitation", "confirmTeamWorkspaceSave", "addTask"]) {
    vm.runInContext(implementation(name), context);
  }
  return { context, state, events };
}

const grant = {
  id: "grant-a", email: "worker@example.com", displayName: "Fixture Worker", roleId: "worker",
  onboardingMode: "employee_link", status: "issued", contractorId: "employer-a",
  employerContractorId: "employer-a", employerUid: "owner-a", employerEmail: "owner-a@example.com",
  visibleTabIds: ["jobs", "photos"], visiblePageIds: ["jobs", "photos"],
  assignedJobIds: ["J-A"], assignedTaskIds: ["TASK-A"]
};

describe("UI-only workflow contracts (mocked IO; not server authorization coverage)", () => {
  it("keeps pending identity, employer, modules, and assignments together", () => {
    const { context, state } = runtime();
    state.accessContext.accessGrants = [structuredClone(grant)];
    expect(context.employeeDirectoryMembers()).toHaveLength(1);
    expect(context.employeeDirectoryMembers()[0]).toMatchObject({
      id: "invite-grant-a", pendingGrantId: "grant-a", status: "Invitation pending",
      employerUid: "owner-a", employerContractorId: "employer-a",
      assignedJobIds: ["J-A"], assignedTaskIds: ["TASK-A"], visiblePageIds: ["jobs", "photos"]
    });
  });

  it("replaces a cached pending identity with the accepted user without losing assignments", () => {
    const { context, state } = runtime();
    state.teamMembers = [context.mapEmployeeGrantToTeamMember(grant)];
    state.accessContext.accessGrants = [{ ...grant, status: "active", firebaseUid: "worker-a" }];
    state.accessContext.users = [{ ...grant, uid: "worker-a", status: "active", email: "WORKER@example.com" }];
    const members = context.employeeDirectoryMembers();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ id: "worker-a", pendingGrantId: "", assignedTaskIds: ["TASK-A"], employerUid: "owner-a" });
  });

  it.each(["revoked", "superseded"])("does not resurrect a %s pending employee from workspace cache", (status) => {
    const { context, state } = runtime();
    state.teamMembers = [context.mapEmployeeGrantToTeamMember(grant)];
    state.accessContext.accessGrants = [{ ...grant, status }];
    expect(context.employeeDirectoryMembers()).toEqual([]);
    expect(context.assignableTeamMembers()).toEqual([]);
  });

  it("keeps a legacy empty module list on role defaults when there is no explicit override", () => {
    const { context } = runtime();
    const member = context.normalizeTeamMember(context.mapUserToTeamMember({
      uid: "worker-a", roleId: "worker", visibleTabIds: [], visiblePageIds: []
    }));
    expect(context.visibleModuleKeysForMember(member)).toEqual(context.employeeAllowedModuleKeys);
  });

  it("preserves an explicit deny-all page override instead of restoring legacy defaults", () => {
    const { context } = runtime();
    const member = context.normalizeTeamMember(context.mapUserToTeamMember({
      uid: "worker-a", roleId: "worker", visibleTabIds: [], visiblePageIds: [],
      permissionsOverride: { pages: { mode: "allow", allowed: [], hidden: [] } }
    }));
    expect(context.visibleModuleKeysForMember(member)).toEqual([]);
  });

  it("does not manufacture module access or publish success for a rejected empty invitation", async () => {
    const requests = [];
    const { context, state, events } = runtime({ apiRequest: async (path, options) => {
      requests.push({ path, payload: JSON.parse(options.body) });
      throw new Error("Select at least one module. Use Disable Account to remove access.");
    } });
    const form = new FormData();
    form.set("displayName", "Fixture Worker");
    form.set("email", "worker@example.com");
    form.set("visibilityConfigured", "1");
    await expect(context.createEmployeeInvitation(form)).rejects.toThrow(/at least one module/i);
    expect(requests.length).toBeLessThanOrEqual(1);
    for (const request of requests) expect(request.payload.visibleModuleKeys).toEqual([]);
    expect(state.lastEmployeeInvitation).toBeUndefined();
    expect(events).toEqual([]);
    expect(form.get("email")).toBe("worker@example.com");
  });

  it("retains exactly the nonempty module allowlist", () => {
    const { context } = runtime();
    expect(context.visibleModuleKeysForMember(context.normalizeTeamMember(context.mapUserToTeamMember({
      uid: "worker-a", roleId: "worker", visibleTabIds: ["photos"], visiblePageIds: ["photos"]
    })))).toEqual(["photos"]);
  });

  it("deduplicates employer choices by contractor identity, not employee identity", () => {
    const { context, state } = runtime();
    state.accessContext.users = [
      { roleId: "contractor", contractorId: "employer-b", displayName: "B" },
      { roleId: "worker", contractorId: "employer-a", displayName: "Not an employer" }
    ];
    state.teamMembers = [{ role: "contractor", contractorId: "employer-b", name: "Cached B" }];
    expect(context.employeeEmployerOptions()).toEqual([{ contractorId: "employer-b", label: "B" }]);
  });

  it("limits contractor invitation job suggestions to visible employer jobs", () => {
    const ownJob = { id: "job-a", jobId: "J-A", title: "Own employer job", contractorId: "employer-a" };
    const { context, state } = runtime({
      currentRoleId: () => "contractor", currentUserFranchiseIds: () => ["franchise-a"],
      visibleJobBoards: () => [ownJob], renderModuleAccessPicker: () => "",
      escapeHtml: (value) => String(value), formatTime: (value) => String(value)
    });
    state.authSession.contractorId = "employer-a";
    state.jobBoards = [ownJob, { id: "job-b", jobId: "J-B-PRIVATE", title: "Other employer job", contractorId: "employer-b" }];
    vm.runInContext(implementation("renderEmployeeInvitationPanel"), context);
    const markup = context.renderEmployeeInvitationPanel();
    expect(markup).toContain("Own employer job");
    expect(markup).not.toContain("J-B-PRIVATE");
    expect(markup).not.toContain("Other employer job");
  });

  it("does not publish pending-profile success before acknowledgment; rejection keeps the modal", async () => {
    const ack = deferred();
    const { context, state, events } = runtime({ apiRequest: () => ack.promise });
    const form = new FormData();
    form.set("grantId", "grant-a");
    form.set("displayName", "Edited employee");
    form.append("visibleModuleKeys", "photos");
    const saving = context.savePendingEmployeeInvitation(form);
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(state.modal).not.toBeNull();
    ack.reject(new Error("Fixture storage unavailable"));
    await expect(saving).rejects.toThrow("Fixture storage unavailable");
    expect(events).toEqual([]);
    expect(state.modal).not.toBeNull();
    context.apiRequest = async () => ({ success: true, grant: { ...grant, displayName: "Edited employee" } });
    await context.savePendingEmployeeInvitation(form);
    expect(events.filter((event) => event === "Pending employee profile updated")).toHaveLength(1);
    expect(state.modal).toBeNull();
  });

  it("does not announce revocation until the mutation acknowledges", async () => {
    const ack = deferred();
    const { context, events } = runtime({ apiRequest: () => ack.promise });
    const revoking = context.revokePendingEmployeeInvitation("grant-a");
    await Promise.resolve();
    expect(events).toEqual([]);
    ack.resolve({ success: true, grant: { ...grant, status: "revoked" } });
    await revoking;
    expect(events).toEqual([{ grant: { ...grant, status: "revoked" } }, "refresh", "Employee invitation revoked", "render"]);
  });
});

function taskRuntime({ jobEmployer = "employer-a", modules = ["photos"], sync } = {}) {
  const ack = deferred();
  const member = { name: "Fixture Worker", ...grant,
    id: "invite-grant-a", pendingGrantId: grant.id, visiblePageIds: modules, visibleTabIds: modules };
  const { context, state, events } = runtime();
  state.teamMembers = [member];
  let sequence = 0;
  Object.assign(context, {
    jobByJobId: () => ({ id: "job-a", jobId: "J-A", contractorId: jobEmployer, companyId: "company-a", branchId: "branch-a", franchiseId: "franchise-a" }),
    visibleJobBoards: () => [context.jobByJobId()],
    isOfflineSmokePreview: () => false,
    createId: () => `TASK-${++sequence}`,
    createFile: (file) => { state.files.push(file); return file; },
    addActivity: () => {}, persist: () => {},
    syncWorkspaceState: sync || (() => ack.promise),
    recoverRejectedWorkspaceState: async () => { state.tasks = []; state.files = []; },
    updatePendingEmployeeInvitation: async (id, payload) => { events.push({ assignment: id, ...payload }); }
  });
  const form = new FormData();
  Object.entries({ assigneeId: member.id, relatedJob: "J-A", moduleKey: "photos", title: "Fixture photo task", due: "2026-11-19" })
    .forEach(([key, value]) => form.set(key, value));
  return { context, state, events, form, ack };
}

describe("job-task linkage and failure/retry (actual UI functions, mocked persistence)", () => {
  it("waits for durable acknowledgment before assignment metadata or success", async () => {
    const { context, state, events, form, ack } = taskRuntime();
    const saving = context.addTask(form);
    saving.catch(() => {});
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(state.tasks[0]).toMatchObject({ relatedJob: "J-A", contractorId: "employer-a", branchId: "branch-a", assigneeEmail: grant.email });
    expect(state.files[0]).toMatchObject({ sourceId: state.tasks[0].id, taskId: state.tasks[0].id,
      relatedJob: "J-A", contractorId: "employer-a", workerEmail: grant.email });
    expect(state.files[0].linkedModuleKeys).toEqual(["jobs", "photos", "time", "photos"]);
    ack.resolve({ success: true, durable: true });
    await saving;
    expect(events[0]).toMatchObject({ assignment: "grant-a", assignedJobIds: ["job-a", "J-A"], assignedTaskIds: [state.tasks[0].id, "TASK-A"] });
    expect(events).toContain("Task assigned");
  });

  it("rolls back a rejected task save and retries as exactly one task and support file", async () => {
    const { context, state, events, form, ack } = taskRuntime();
    const saving = context.addTask(form);
    ack.reject(new Error("Fixture storage unavailable"));
    await expect(saving).rejects.toThrow("Fixture storage unavailable");
    expect(state.tasks).toEqual([]);
    expect(state.files).toEqual([]);
    expect(events).toEqual([]);
    context.syncWorkspaceState = async () => ({ success: true, durable: true });
    await context.addTask(form);
    expect(state.tasks).toHaveLength(1);
    expect(state.files).toHaveLength(1);
    expect(events.filter((event) => event === "Task assigned")).toHaveLength(1);
  });

  it("rejects assignment to a module the employee cannot open before any write", async () => {
    const { context, state, events, form } = taskRuntime({ modules: ["time"], sync: async () => { throw new Error("Persistence must not run"); } });
    await expect(context.addTask(form)).rejects.toThrow(/Enable photos/);
    expect(state.tasks).toEqual([]);
    expect(state.files).toEqual([]);
    expect(events).toEqual([]);
  });

  it("rejects a task joining an employee to another employer's job before any write", async () => {
    let writes = 0;
    const { context, state, form } = taskRuntime({ jobEmployer: "employer-b", sync: async () => { writes += 1; return { durable: true }; } });
    await expect(context.addTask(form)).rejects.toThrow(/employer|contractor/i);
    expect(writes).toBe(0);
    expect(state.tasks).toEqual([]);
    expect(state.files).toEqual([]);
  });

  it.each([
    { success: true, durable: false, ignoredRecords: 0 },
    { success: true, durable: true, ignoredRecords: 1 }
  ])("rejects incomplete persistence acknowledgment %j without reporting assignment success", async (response) => {
    const { context, state, events, form } = taskRuntime({ sync: async () => response });
    await expect(context.addTask(form)).rejects.toThrow(/did not confirm/);
    expect(state.tasks).toEqual([]);
    expect(state.files).toEqual([]);
    expect(events).toEqual([]);
  });

  it("retries a saved task's failed assignment update without duplicating task or support file", async () => {
    let writes = 0;
    let assignments = 0;
    const { context, state, events, form } = taskRuntime({ sync: async () => { writes += 1; return { durable: true }; } });
    form.set("taskId", "TASK-RETRY-1");
    context.updatePendingEmployeeInvitation = async () => {
      assignments += 1;
      if (assignments === 1) throw new Error("Fixture assignment update unavailable");
      return { ...grant, assignedTaskIds: ["TASK-RETRY-1"] };
    };
    await expect(context.addTask(form)).rejects.toThrow(/was saved, but its employee assignment was not updated/);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: "TASK-RETRY-1", assignmentSyncPending: true });
    expect(state.files).toHaveLength(1);
    expect(events).not.toContain("Task assigned");
    await context.addTask(form);
    expect(writes).toBe(3);
    expect(assignments).toBe(2);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: "TASK-RETRY-1", assignmentSyncPending: false });
    expect(state.files).toHaveLength(1);
    expect(state.files[0].sourceId).toBe("TASK-RETRY-1");
    expect(events.filter((event) => event === "Task assigned")).toHaveLength(1);
  });
});
