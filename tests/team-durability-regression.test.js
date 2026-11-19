import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { normalizeUserRecord } = createRequire(import.meta.url)("../lib/os-access-control.js");

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function implementation(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`Missing function ${name}`);
  const next = source.slice(start + 1).search(/^(?:async )?function \w+\(/m);
  return source.slice(start, next < 0 ? source.length : start + next + 1);
}

class TestFormData extends FormData {
  constructor(form) {
    super();
    for (const field of form?.elements || []) {
      if (!field.name || field.disabled || (["checkbox", "radio"].includes(field.type) && !field.checked)) continue;
      if (field.type === "select-multiple") {
        for (const option of field.options) if (option.selected) this.append(field.name, option.value);
      } else this.append(field.name, field.value);
    }
  }
}

function data(values) {
  const result = new TestFormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) result.append(key, item);
  }
  return result;
}

const grant = {
  id: "grant-1", displayName: "Worker", email: "worker@example.test", roleId: "worker",
  onboardingMode: "employee_link", status: "issued", companyId: "company-1",
  contractorId: "employer-1", employerContractorId: "employer-1", employerUid: "owner-1",
  visiblePageIds: ["jobs", "photos", "time"], visibleTabIds: ["jobs", "photos", "time"],
  assignedJobIds: [], assignedTaskIds: []
};
const job = { id: "job-1", jobId: "J-100", title: "Dryout", contractorId: "employer-1", companyId: "company-1", branchId: "branch-1" };

function runtime() {
  const state = {
    authSession: { uid: "owner-1", email: "owner@example.test", companyId: "company-1" },
    firebase: { enabled: true }, workspacePersistence: { status: "saved" },
    accessContext: { users: [], accessGrants: [structuredClone(grant)] },
    teamMembers: [], tasks: [], files: [], jobBoards: [structuredClone(job)], modal: null
  };
  const ui = { forms: [], submit: null };
  const snapshots = [];
  let id = 0;
  const context = vm.createContext({
    state, Date, FormData: TestFormData, Set, Map,
    modules: ["team", "jobs", "photos", "time"].map((key) => ({ key })),
    employeeAllowedModuleKeys: ["jobs", "photos", "time"], defaultContractorModuleKeys: ["jobs"],
    rbacActionKeys: ["inviteWorkers", "editAssignedTasks"],
    today: new Date("2026-01-01T12:00:00Z"),
    normalizePriceToken: (value) => String(value).replace(/[^a-z0-9]/gi, "-"),
    normalizeListValue: (value) => Array.isArray(value) ? value : String(value || "").split(",").filter(Boolean),
    moduleKeysFromList: (value) => Array.isArray(value) ? value : [],
    defaultModuleAccessForRole: () => ["jobs", "photos", "time"],
    applicationIdsForModuleKeys: () => ["field"],
    currentUserFranchiseIds: () => [], currentContractorId: () => "employer-1",
    currentRoleId: () => "super_admin", canDo: vi.fn(() => true),
    isOfflineSmokePreview: () => false, workspaceWritesReady: () => true,
    createId: (prefix) => `${prefix}-${++id}`, moduleByKey: (key) => ({ key, label: key }),
    visibleJobBoards: () => state.jobBoards, formatTime: (value) => value,
    apiRequest: vi.fn(async () => ({ grant: structuredClone(grant), accessLink: "#fixture", user: { ...grant, uid: "worker-1" } })),
    refreshAccessContext: vi.fn(async () => {}),
    syncWorkspaceState: vi.fn(async () => { snapshots.push(structuredClone({ tasks: state.tasks, files: state.files, teamMembers: state.teamMembers })); return { durable: true }; }),
    recoverRejectedWorkspaceState: vi.fn(async () => {}),
    persist: vi.fn(), addActivity: vi.fn(), render: vi.fn(), setToast: vi.fn(), closeModal: vi.fn(),
    createFile: vi.fn((record) => { state.files.push(record); return record; }),
    document: {
      querySelectorAll: () => ui.forms,
      addEventListener: (name, callback) => { if (name === "submit") ui.submit = callback; }
    }
  });
  const functions = [
    "csvValues", "moduleVisibilityPayload", "normalizeTeamMember", "visibleModuleKeysForMember", "mapUserToTeamMember",
    "mapEmployeeGrantToTeamMember", "employeeDirectoryMembers", "assignableTeamMembers", "mergeById",
    "upsertAccessGrant", "upsertManagedUser", "refreshTeamAfterSave", "runTeamAction", "submitDurableForm",
    "createAccessGrant", "createEmployeeInvitation", "updateEmployeeAssignments", "updatePendingEmployeeInvitation",
    "savePendingEmployeeInvitation", "revokePendingEmployeeInvitation", "createSecureUser", "updateSecureUser",
    "saveRolePermissions", "addTeamMember", "confirmTeamWorkspaceSave", "addTask", "retryTaskAssignment",
    "completeTask", "fieldSessionForMember", "saveEmployeeProfile"
  ];
  for (const name of functions) vm.runInContext(implementation(name), context);
  const submitStart = source.indexOf('document.addEventListener("submit",');
  const submitEnd = source.indexOf('\ndocument.addEventListener(', submitStart + 1);
  vm.runInContext(source.slice(submitStart, submitEnd), context);
  return { context, state, ui, snapshots };
}

function taskData(overrides = {}) {
  return data({ taskId: "TASK-stable", title: "Dryout photos", assigneeId: "invite-grant-1", moduleKey: "photos", relatedJob: "J-100", due: "2026-01-01", priority: "High", ...overrides });
}

function fakeForm(type, elements = []) {
  elements.namedItem = (name) => elements.find((field) => field.name === name);
  const buttons = [{ disabled: false }, { disabled: true }];
  const form = { dataset: { form: type }, elements, buttons, querySelectorAll: () => buttons };
  form.closest = () => form;
  return form;
}

async function acceptedRetryRuntime() {
  const original = runtime();
  original.context.apiRequest.mockRejectedValueOnce(new Error("Assignment rejected"));
  await expect(original.context.addTask(taskData())).rejects.toThrow("Task TASK-stable was saved");
  const reloaded = runtime();
  Object.assign(reloaded.state, structuredClone(original.snapshots[0]));
  const acceptedUser = { ...grant, id: "firebase-worker-1", uid: "firebase-worker-1", status: "active", email: " WORKER@example.test " };
  reloaded.state.accessContext.accessGrants = [{ ...grant, status: "active", firebaseUid: acceptedUser.uid }];
  reloaded.state.accessContext.users = [acceptedUser];
  reloaded.state.files[0].id = "FILE-stable";
  reloaded.state.tasks[0].photoEvidenceIds = ["PHOTO-stable"];
  reloaded.state.photoRecords = [{ id: "PHOTO-stable", taskId: "TASK-stable", workerId: acceptedUser.uid }];
  reloaded.state.timeEntries = [{ id: "TIME-stable", taskId: "TASK-stable", workerId: acceptedUser.uid }];
  reloaded.context.apiRequest.mockResolvedValue({ user: acceptedUser });
  return reloaded;
}

describe("team durable form handlers", () => {
  it.each(["team-member", "rbac-user", "access-grant", "employee-invitation", "employee-profile", "pending-employee-manage", "user-manage", "role-permissions"])("retains the %s draft on rejection", async (type) => {
    const { context, ui, state } = runtime();
    state.modal = { type: "pending-employee-manage", grantId: "grant-1" };
    const fields = [
      { name: "displayName", value: "Unsaved name", type: "text" },
      { name: "uid", value: "worker-1", type: "hidden" },
      { name: "grantId", value: "grant-1", type: "hidden" },
      { name: "visibleModuleKeys", value: "photos", type: "checkbox", checked: true },
      { name: "visibleModuleKeys", value: "jobs", type: "checkbox", checked: false }
    ];
    const form = fakeForm(type, fields);
    ui.forms = [form];
    context.apiRequest.mockRejectedValue(new Error("Rejected by server"));
    await ui.submit({ target: form, preventDefault() {} });
    expect(fields[0].value).toBe("Unsaved name");
    expect(fields.slice(3).map((field) => field.checked)).toEqual([true, false]);
    expect(form.buttons.map((button) => button.disabled)).toEqual([false, true]);
    expect(state.modal).toEqual({ type: "pending-employee-manage", grantId: "grant-1" });
    expect(context.render).not.toHaveBeenCalled();
    expect(context.setToast).toHaveBeenLastCalledWith("Rejected by server");
  });

  it("restores checkbox values, radios, and multi-selects after replacement", async () => {
    const { context, ui } = runtime();
    const fields = [
      { name: "visibleModuleKeys", value: "photos", type: "checkbox", checked: true },
      { name: "visibleModuleKeys", value: "jobs", type: "checkbox", checked: false },
      { name: "mode", value: "field", type: "radio", checked: true },
      { name: "mode", value: "office", type: "radio", checked: false },
      { name: "jobs", type: "select-multiple", options: [{ value: "a", selected: true }, { value: "b", selected: false }] },
      { name: "empty", type: "select-multiple", options: [{ value: "c", selected: false }] }
    ];
    const form = fakeForm("employee-invitation", fields);
    const replacement = fakeForm("employee-invitation", structuredClone([...fields]));
    replacement.elements.forEach((field) => { field.checked = true; field.options?.forEach((option) => { option.selected = true; }); });
    ui.forms = [replacement];
    await context.submitDurableForm(form, async () => { throw new Error("Rejected"); });
    expect(replacement.elements.slice(0, 4).map((field) => field.checked)).toEqual([true, false, true, false]);
    expect(replacement.elements[4].options.map((option) => option.selected)).toEqual([true, false]);
    expect(replacement.elements[5].options[0].selected).toBe(false);
    expect(form.buttons.map((button) => button.disabled)).toEqual([false, true]);
  });

  it("blocks duplicate form submissions until the first operation settles", async () => {
    const { context } = runtime();
    const form = fakeForm("employee-invitation");
    let finish;
    const operation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const first = context.submitDurableForm(form, operation);
    await context.submitDurableForm(form, operation);
    expect(operation).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(form.buttons.map((button) => button.disabled)).toEqual([false, true]);
  });

  it("blocks duplicate action buttons across a rerender and retains drafts on failure", async () => {
    const { context } = runtime();
    const button = { dataset: { action: "revoke-employee-invitation", id: "grant-1" }, disabled: false };
    let reject;
    const operation = vi.fn(() => new Promise((_, no) => { reject = no; }));
    const first = context.runTeamAction(button, operation);
    await context.runTeamAction({ ...button }, operation);
    reject(new Error("Not revoked"));
    await first;
    expect(operation).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(context.render).not.toHaveBeenCalled();
  });
});

describe("team server acknowledgement and identity", () => {
  it.each(["createEmployeeInvitation", "createAccessGrant", "createSecureUser", "saveEmployeeProfile"])("does not misreport a committed %s as rejected when refresh fails", async (name) => {
    const { context, state } = runtime();
    context.refreshAccessContext.mockRejectedValue(new Error("Refresh offline"));
    await expect(context[name](data({ displayName: "Worker", email: grant.email, visibleModuleKeys: ["photos"] }))).resolves.toBeUndefined();
    expect(context.apiRequest).toHaveBeenCalledTimes(1);
    expect(context.setToast.mock.lastCall[0]).toContain("directory refresh failed");
    if (name === "saveEmployeeProfile") expect(state.worker.employerUid).toBe("owner-1");
  });

  it.each(["updateEmployeeAssignments", "updatePendingEmployeeInvitation", "revokePendingEmployeeInvitation"])("rejects unavailable %s instead of reporting a successful no-op", async (name) => {
    const { context, state } = runtime();
    state.firebase.enabled = false;
    await expect(context[name]("id", [], [])).rejects.toThrow();
    expect(context.apiRequest).not.toHaveBeenCalled();
    expect(context.setToast).not.toHaveBeenCalled();
  });

  it("keeps a pending profile open when the server omits its acknowledgement", async () => {
    const { context, state } = runtime();
    state.modal = { type: "pending-employee-manage", grantId: "grant-1" };
    context.apiRequest.mockResolvedValue({ success: true });
    await expect(context.savePendingEmployeeInvitation(data({ grantId: "grant-1", displayName: "Draft" }))).rejects.toThrow("did not confirm");
    expect(state.modal.grantId).toBe("grant-1");
    expect(context.setToast).not.toHaveBeenCalled();
  });

  it("retains the issued link and warns when the ancillary team file cannot persist", async () => {
    const { context, state } = runtime();
    context.syncWorkspaceState.mockRejectedValue(new Error("Workspace rejected"));
    context.recoverRejectedWorkspaceState.mockImplementation(async () => { state.lastAccessGrant = null; state.teamMembers = []; });
    await context.addTeamMember(data({ name: "Worker", email: grant.email, visibleModuleKeys: ["jobs"] }));
    expect(context.apiRequest).toHaveBeenCalledTimes(1);
    expect(state.lastAccessGrant.accessLink).toBe("#fixture");
    expect(context.setToast.mock.lastCall[0]).toContain("Do not recreate the invitation");
    expect(context.createFile.mock.calls[0][1]).toEqual({ announce: false });
  });

  it("does not silently broaden an explicitly empty login selection", async () => {
    const { context } = runtime();
    await expect(context.addTeamMember(data({ visibilityConfigured: "true" }))).rejects.toThrow("at least one module");
    expect(context.apiRequest).not.toHaveBeenCalled();
    const member = context.normalizeTeamMember(context.mapUserToTeamMember({ uid: "worker-1", visiblePageIds: [], visibleTabIds: [], permissionsOverride: { pages: { mode: "allow", allowed: [] } } }));
    expect(context.visibleModuleKeysForMember(member)).toEqual([]);
  });

  it("retains legacy empty-list role defaults and server-derived owner access", () => {
    const { context } = runtime();
    const legacy = context.normalizeTeamMember(context.mapUserToTeamMember({ uid: "worker-1", roleId: "worker", visiblePageIds: [], visibleTabIds: [] }));
    expect(context.visibleModuleKeysForMember(legacy)).toEqual(["jobs", "photos", "time"]);
    const owner = normalizeUserRecord("owner", null, { roleId: "super_admin", visiblePageIds: [], visibleTabIds: [] });
    const mappedOwner = context.normalizeTeamMember(context.mapUserToTeamMember(owner));
    expect(context.visibleModuleKeysForMember(mappedOwner)).toContain("jobs");
    expect(context.visibleModuleKeysForMember(mappedOwner)).toContain("team");
  });

  it("honors authoritative effective access and explicit deny-all overrides", () => {
    const { context } = runtime();
    const restricted = normalizeUserRecord("worker", null, { roleId: "worker", permissionsOverride: { pages: { mode: "allow", allowed: ["photos"] } } });
    expect(context.visibleModuleKeysForMember(context.normalizeTeamMember(context.mapUserToTeamMember(restricted)))).toEqual(["photos"]);
    const denied = normalizeUserRecord("owner", null, { roleId: "super_admin", permissionsOverride: { pages: { mode: "allow", allowed: [] } } });
    expect(context.visibleModuleKeysForMember(context.normalizeTeamMember(context.mapUserToTeamMember(denied)))).toEqual([]);
  });

  it.each(["createSecureUser", "createAccessGrant"])("rejects an empty %s picker before sending a request", async (name) => {
    const { context } = runtime();
    await expect(context[name](data({ visibilityConfigured: "true" }))).rejects.toThrow("at least one module");
    expect(context.apiRequest).not.toHaveBeenCalled();
  });

  it("rejects empty user updates without blocking updates that omit module fields", async () => {
    const { context } = runtime();
    await expect(context.updateSecureUser({ uid: "worker-1", visiblePageIds: [], visibleTabIds: [] })).rejects.toThrow("at least one module");
    expect(context.apiRequest).not.toHaveBeenCalled();
    await context.updateSecureUser({ uid: "worker-1", disabled: true });
    expect(context.apiRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps current server invitation edits ahead of stale cached profiles", () => {
    const { context, state } = runtime();
    state.teamMembers = [context.mapEmployeeGrantToTeamMember({ ...grant, displayName: "Old name" })];
    expect(context.employeeDirectoryMembers()[0].name).toBe("Worker");
    state.accessContext.accessGrants[0].status = "revoked";
    expect(context.employeeDirectoryMembers()).toEqual([]);
  });
});

describe("task durability and retry identity", () => {
  it("persists the task and linked evidence record before updating the pending assignment", async () => {
    const { context, state, snapshots } = runtime();
    await context.addTask(taskData());
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].tasks[0].assignmentSyncPending).toBe(true);
    expect(snapshots[1].tasks[0].assignmentSyncPending).toBe(false);
    expect(context.syncWorkspaceState.mock.invocationCallOrder[0]).toBeLessThan(context.apiRequest.mock.invocationCallOrder[0]);
    expect(state.files[0]).toMatchObject({ taskId: "TASK-stable", workerId: "invite-grant-1", jobId: "job-1", contractorId: "employer-1", employerUid: "owner-1", branchId: "branch-1" });
    expect(state.files[0].linkedModuleKeys).toEqual(["jobs", "photos", "time", "photos"]);
    expect(JSON.parse(context.apiRequest.mock.calls[0][1].body).assignedJobIds).toEqual(["job-1"]);
  });

  it("retries the same task after assignment failure, including after reload", async () => {
    const { context, state, snapshots } = runtime();
    context.apiRequest.mockRejectedValueOnce(new Error("Assignment rejected"));
    await expect(context.addTask(taskData())).rejects.toThrow("Task TASK-stable was saved");
    expect(context.setToast).not.toHaveBeenCalledWith("Task assigned");
    const reloaded = runtime();
    Object.assign(reloaded.state, structuredClone(snapshots[0]));
    expect(reloaded.state.tasks[0].assignmentSyncPending).toBe(true);
    await reloaded.context.retryTaskAssignment("TASK-stable");
    expect(reloaded.state.tasks).toHaveLength(1);
    expect(reloaded.state.files).toHaveLength(1);
    expect(reloaded.state.tasks[0]).toMatchObject({ id: "TASK-stable", assignmentSyncPending: false });
    await context.addTask(taskData());
    expect(state.tasks).toHaveLength(1);
    expect(state.files).toHaveLength(1);
  });

  it("canonicalizes an accepted invitation identity on retry without changing task, file, photo, or time links", async () => {
    const { context, state, snapshots } = await acceptedRetryRuntime();
    const photos = structuredClone(state.photoRecords);
    const time = structuredClone(state.timeEntries);
    await context.retryTaskAssignment("TASK-stable");
    expect(state.tasks).toHaveLength(1);
    expect(state.files).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: "TASK-stable", assigneeId: "firebase-worker-1", assignmentSyncPending: false, photoEvidenceIds: ["PHOTO-stable"], companyId: "company-1", contractorId: "employer-1", employerUid: "owner-1" });
    expect(state.files[0]).toMatchObject({ id: "FILE-stable", sourceId: "TASK-stable", taskId: "TASK-stable", workerId: "firebase-worker-1", jobId: "job-1" });
    expect(state.photoRecords).toEqual(photos);
    expect(state.timeEntries).toEqual(time);
    expect(snapshots[0].tasks[0]).toMatchObject({ assigneeId: "firebase-worker-1", assignmentSyncPending: true });
    expect(snapshots[0].files[0].workerId).toBe("firebase-worker-1");
    expect(context.apiRequest).toHaveBeenCalledTimes(1);
    expect(context.apiRequest.mock.calls[0][0]).toBe("/api/employees/firebase-worker-1/assignments");
    expect(JSON.parse(context.apiRequest.mock.calls[0][1].body).assignedTaskIds).toEqual(["TASK-stable"]);
    expect(context.syncWorkspaceState.mock.invocationCallOrder[0]).toBeLessThan(context.apiRequest.mock.invocationCallOrder[0]);
  });

  it.each([
    ["missing grant mapping", (state) => { state.accessContext.accessGrants = []; }],
    ["missing Firebase UID", (state) => { delete state.accessContext.accessGrants[0].firebaseUid; }],
    ["different grant ID", (state) => { state.accessContext.accessGrants[0].id = "unrelated-grant"; }],
    ["inactive grant", (state) => { state.accessContext.accessGrants[0].status = "revoked"; }],
    ["foreign grant company", (state) => { state.accessContext.accessGrants[0].companyId = "other-company"; }],
    ["foreign user company", (state) => { state.accessContext.users[0].companyId = "other-company"; }],
    ["foreign grant employer", (state) => { state.accessContext.accessGrants[0].employerContractorId = "other-employer"; }],
    ["foreign user employer", (state) => { state.accessContext.users[0].employerContractorId = "other-employer"; }],
    ["different employer UID", (state) => { state.accessContext.users[0].employerUid = "other-owner"; }],
    ["different email", (state) => { state.accessContext.users[0].email = "other@example.test"; }]
  ])("does not rebind an accepted retry with %s", async (_, change) => {
    const { context, state } = await acceptedRetryRuntime();
    change(state);
    const before = structuredClone({ tasks: state.tasks, files: state.files });
    await expect(context.retryTaskAssignment("TASK-stable")).rejects.toThrow("Select an active team member");
    expect({ tasks: state.tasks, files: state.files }).toEqual(before);
    expect(context.syncWorkspaceState).not.toHaveBeenCalled();
    expect(context.apiRequest).not.toHaveBeenCalled();
  });

  it.each([null, { durable: false }, { durable: true, ignoredRecords: 1 }])("does not send assignment updates without a complete durable acknowledgement: %j", async (result) => {
    const { context } = runtime();
    context.syncWorkspaceState.mockResolvedValue(result);
    await expect(context.addTask(taskData())).rejects.toThrow("did not confirm");
    expect(context.apiRequest).not.toHaveBeenCalled();
    expect(context.setToast).not.toHaveBeenCalled();
  });

  it("does not announce success before the final profile-linked workspace save", async () => {
    const { context } = runtime();
    context.syncWorkspaceState.mockResolvedValueOnce({ durable: true }).mockRejectedValueOnce(new Error("Final save rejected"));
    await expect(context.addTask(taskData())).rejects.toThrow("Final save rejected");
    expect(context.setToast).not.toHaveBeenCalledWith("Task assigned");
    expect(context.recoverRejectedWorkspaceState).toHaveBeenCalledTimes(1);
  });

  it("rejects employer mismatches and ambiguous job numbers before mutation", async () => {
    const { context, state } = runtime();
    state.jobBoards[0].contractorId = "other-employer";
    await expect(context.addTask(taskData())).rejects.toThrow("same employer");
    state.jobBoards.push({ ...job, id: "job-2" });
    await expect(context.addTask(taskData())).rejects.toThrow("ambiguous");
    expect(state.tasks).toEqual([]);
    expect(context.syncWorkspaceState).not.toHaveBeenCalled();
    await context.addTask(taskData({ relatedJob: "job-2" }));
    expect(state.tasks[0].jobId).toBe("job-2");
  });

  it("retries completion profile sync without duplicating history or changing unrelated empty-email workers", async () => {
    const { context, state, snapshots } = runtime();
    state.accessContext.accessGrants = [];
    state.teamMembers = [{ id: "worker-1", name: "Worker", email: "", assignedTaskIds: ["TASK-stable"] }, { id: "other", email: "", assignedTaskIds: ["TASK-stable"] }];
    state.accessContext.users = [{ uid: "worker-1", roleId: "worker", assignedTaskIds: ["TASK-stable"] }];
    state.tasks = [{ id: "TASK-stable", assigneeId: "worker-1", assigneeEmail: "", status: "Open", title: "Work" }];
    state.files = [{ sourceType: "taskAssignment", sourceId: "TASK-stable", history: [] }];
    context.apiRequest.mockRejectedValueOnce(new Error("Profile unavailable"));
    await context.completeTask("TASK-stable");
    expect(snapshots[0].tasks[0]).toMatchObject({ status: "Complete", assignmentSyncPending: true });
    await context.retryTaskAssignment("TASK-stable");
    expect(state.tasks[0].assignmentSyncPending).toBe(false);
    expect(state.files[0].history).toHaveLength(1);
    expect(state.teamMembers.find((member) => member.id === "other").assignedTaskIds).toEqual(["TASK-stable"]);
  });
});
