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
    expect(teamModule).toContain("const displayedUsers = assignableTeamMembers()");
    expect(teamModule).toContain("Secure login manager is active");
    expect(teamModule).toContain("${renderTeamForm()}");
  });

  it("creates employees with individual portal codes, assigned jobs, and communication access", () => {
    const form = functionBody("renderTeamForm");
    const addTeamMember = functionBody("addTeamMember");
    expect(form).toContain('name="accessCode"');
    expect(form).toContain('name="assignedJobIds"');
    expect(form).toContain('"communications"');
    expect(addTeamMember).toContain("accessCode");
    expect(addTeamMember).toContain("assignedJobIds");
    expect(addTeamMember).toContain('linkedModuleKeys: ["jobs", "time", "photos", "communications"]');
  });

  it("uses per-employee portal login instead of a shared static worker code", () => {
    expect(source).toContain("function findEmployeeForPortalLogin(identifier, accessCode)");
    expect(source).toContain("employeeAccessCodeFor(member)");
    expect(source).toContain("loginEmployeePortal(formData)");
    expect(source).not.toContain("code.toUpperCase() !== workerAccessCode");
    expect(source).toContain('name="identifier"');
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

  it("saves photo evidence into jobs, billing, defensibility, closeout, and task completion", () => {
    const addPhotoEvidence = functionBody("addPhotoEvidence");
    expect(addPhotoEvidence).toContain("state.photoRecords = [record, ...(state.photoRecords || [])]");
    expect(addPhotoEvidence).toContain('markJobGateDone(record.jobId, "photos")');
    expect(addPhotoEvidence).toContain('task.status = "Complete"');
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
