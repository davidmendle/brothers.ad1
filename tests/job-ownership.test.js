import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { equipmentRecordScope } from "../equipment-lifecycle.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const creation = source.slice(source.indexOf("function addJobRecord("), source.indexOf("function currentRoleId("));
const employer = source.slice(source.indexOf("function currentEmployerContractorId("), source.indexOf("function employeeEmployerOptions("));

function runtime() {
  const state = { branches: [{ id: "branch-a", franchiseId: "franchise-a" }], jobBoards: [], authSession: { email: "Owner+Office@Example.com" } };
  const files = [], tasks = [], messages = [];
  const context = vm.createContext({
    state, today: new Date("2026-01-01T12:00:00Z"), equipmentRecordScope,
    currentContractorId: () => "", currentSessionUser: () => null,
    employeeEmployerOptions: () => [{ contractorId: "contractor-b", label: "Contractor B" }],
    createId: () => "job-a", createFile: (file) => files.push(file),
    ensureWorkflowTasks: (records) => tasks.push(...records),
    setToast: (message) => messages.push(message), addActivity: () => {}, persist: () => {}, render: () => {}
  });
  vm.runInContext(`${employer}\n${creation}`, context);
  const form = new FormData();
  form.set("jobId", "J-100");
  form.set("title", "Water loss");
  return { context, state, files, tasks, messages, form };
}

describe("job ownership and linked records", () => {
  it("uses the same owner employer ID as employee invitations", () => {
    const { context, state, files, tasks, form } = runtime();
    context.addJobRecord(form);
    const scope = { contractorId: "employer-owner_office_example_com", branchId: "branch-a", franchiseId: "franchise-a" };
    expect(state.jobBoards[0]).toMatchObject(scope);
    expect(files[0]).toMatchObject({ ...scope, jobId: "job-a", relatedJob: "J-100" });
    expect(tasks).toHaveLength(5);
    for (const task of tasks) expect(task).toMatchObject({ ...scope, jobId: "job-a", relatedJob: "J-100" });
  });

  it("supports an existing contractor selection without changing the owner's employer", () => {
    const { context, state, form } = runtime();
    form.set("contractorId", "contractor-b");
    context.addJobRecord(form);
    expect(state.jobBoards[0].contractorId).toBe("contractor-b");
    expect(context.currentEmployerContractorId()).toBe("employer-owner_office_example_com");
  });

  it("does not create records for an unknown employer profile", () => {
    const { context, state, files, tasks, messages, form } = runtime();
    form.set("contractorId", "forged");
    context.addJobRecord(form);
    expect(state.jobBoards).toHaveLength(0);
    expect(files).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(messages[0]).toContain("existing employer");
  });
});
