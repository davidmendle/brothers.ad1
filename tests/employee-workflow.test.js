import fs from "fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\b`));
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextAsyncFunction = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter((index) => index > start);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("employee task, time, photo, and note workflow", () => {
  it("keeps owner-created employee profiles visible while Firebase user management is active", () => {
    const teamModule = functionBody("renderTeamModule");
    expect(source).toContain("function mergeSessionTeamMembers(users = [])");
    expect(source).toContain("function employeeDirectoryMembers()");
    expect(source).toContain("function mapEmployeeGrantToTeamMember(grant = {})");
    expect(source).toContain("function employeeEmployerOptions()");
    expect(source).toContain("<span>Employer profile</span><select name=\"contractorId\">");
    expect(source).toContain("Brothers Restoration owner account");
    expect(teamModule).toContain("const displayedUsers = employeeDirectoryMembers()");
    expect(teamModule).toContain("${renderEmployeeInvitationPanel()}");
    expect(teamModule).toContain("${renderTeamForm()}");
  });

  it("creates named employee profiles before acceptance and keeps pending assignments connected", () => {
    const form = functionBody("renderEmployeeInvitationPanel");
    const createInvitation = functionBody("createEmployeeInvitation");
    const addTask = functionBody("addTask");
    expect(form).toContain('name="displayName"');
    expect(form).toContain('name="phone"');
    expect(form).toContain('name="jobTitle"');
    expect(form).toContain('name="assignedJobIds"');
    expect(form).toContain("Pending invitations appear here immediately");
    expect(createInvitation).toContain("displayName");
    expect(createInvitation).toContain("assignedJobIds");
    expect(addTask).toContain("updatePendingEmployeeInvitation");
    expect(source).toContain('linkedModuleKeys: ["jobs", "time", "photos", "communications"]');
  });

  it("requires server-verified Google login instead of a source-visible worker code", () => {
    expect(source).not.toContain("function findEmployeeForPortalLogin");
    expect(source).not.toContain("loginEmployeePortal(formData)");
    expect(source).not.toContain("FIELD-2039");
    expect(source).not.toContain('data-form="employee-login"');
    expect(source).toContain("Google-secured field portal");
    expect(source).toContain('data-action="employee-google-switch"');
  });

  it("scopes employee tasks, jobs, time entries, dry logs, files, and modules", () => {
    expect(functionBody("visibleTasks")).toContain("if (state.employeeMode) return state.tasks.filter(taskMatchesCurrentWorker)");
    expect(functionBody("visibleJobBoards")).toContain("if (state.employeeMode) return state.jobBoards.filter(jobMatchesCurrentWorker)");
    expect(functionBody("visibleTimeEntries")).toContain("if (state.employeeMode) return state.timeEntries.filter(timeEntryMatchesCurrentWorker)");
    expect(source).toContain("function visibleDryLogs()");
    expect(source).toContain("function fileVisibleToCurrentWorker(file)");
    expect(source).toContain("function employeeModuleKeys()");
  });

  it("links assigned tasks back to the assignee profile and related modules", () => {
    const addTask = functionBody("addTask");
    expect(addTask).toContain("assigneeName");
    expect(addTask).toContain("assigneeEmail");
    expect(addTask).toContain("assignedTaskIds");
    expect(addTask).toContain("assignedJobIds");
    expect(addTask).toContain('sourceType: "taskAssignment"');
    expect(addTask).toContain('linkedModuleKeys: ["jobs", task.moduleKey, "time", "photos"]');
  });

  it("keeps task completion synchronized with the employee and assignment file", () => {
    const completeTask = functionBody("completeTask");
    expect(functionBody("addPhotoEvidence")).not.toContain("completeTask(task.id)");
    expect(functionBody("renderTeamMemberCard")).toContain('if (task.status === "Complete") return false');
    expect(completeTask).toContain("updatePendingEmployeeInvitation");
    expect(completeTask).toContain("updateEmployeeAssignments");
    expect(completeTask).toContain('file.sourceType === "taskAssignment"');
    expect(completeTask).toContain('assignmentFile.status = "Complete"');
    expect(completeTask).toContain("remainingAssignedTaskIds");
  });

  it("uses invitation-specific controls before an employee accepts", () => {
    const card = functionBody("renderTeamMemberCard");
    expect(card).toContain("pendingGrantId");
    expect(card).toContain('data-action="open-pending-employee-manage"');
    expect(card).toContain('data-action="revoke-employee-invitation"');
    expect(card).toContain("managedUserId");
    expect(source).toContain('data-form="pending-employee-manage"');
  });

  it("lets task assignment target field modules such as photos, payments, and communications", () => {
    expect(source).toContain("function taskAssignableModules()");
    expect(functionBody("taskAssignableModules")).toContain("employeeAllowedModuleKeys");
    expect(functionBody("renderTaskForm")).toContain("const taskModules = taskAssignableModules()");
    expect(functionBody("renderTaskForm")).toContain('value="${item.key}"');
  });

  it("routes photos to an operational upload and notes workspace", () => {
    expect(source).toContain('if (module.key === "photos") return renderPhotosModule(module);');
    expect(source).toContain('data-form="photo-evidence"');
    expect(source).toContain('data-form="job-note"');
    expect(source).toContain('if (type === "photo-evidence")');
    expect(source).toContain('if (type === "job-note")');
  });

  it("saves photo evidence across modules while keeping GPS ticket completion separate", () => {
    const addPhotoEvidence = functionBody("addPhotoEvidence");
    expect(addPhotoEvidence).toContain("state.photoRecords = [record, ...(state.photoRecords || [])]");
    expect(addPhotoEvidence).toContain('markJobGateDone(record.jobId, "photos")');
    expect(addPhotoEvidence).toContain("task.photoEvidenceIds");
    expect(addPhotoEvidence).toContain("sign the ticket with GPS to complete it");
    expect(addPhotoEvidence).not.toContain("completeTask(task.id)");
    expect(addPhotoEvidence).toContain('linkedModuleKeys: ["jobs", "drylogs", "time", "equipment", "payments", "defensibility", "closeout"]');
  });

  it("saves job notes as linked field records", () => {
    const addJobNote = functionBody("addJobNote");
    expect(addJobNote).toContain('sourceType: "jobNote"');
    expect(addJobNote).toContain('linkedModuleKeys: ["photos", "time", "drylogs", "equipment", "communications", "closeout"]');
  });

  it("connects time entries to worker identity, assigned task IDs, and photo support", () => {
    const clockIn = functionBody("clockIn");
    const clockOut = functionBody("clockOut");
    expect(clockIn).toContain("workerId");
    expect(clockIn).toContain("workerEmail");
    expect(clockIn).toContain("taskId");
    expect(clockIn).toContain("selectedTask?.title");
    expect(clockOut).toContain('linkedModuleKeys: ["jobs", "payments", "reports", "closeout", "photos"]');
  });
});
