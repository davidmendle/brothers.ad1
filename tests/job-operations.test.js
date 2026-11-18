import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import { isEquipmentActive } from "../equipment-lifecycle.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const summary = source.slice(source.indexOf("function renderJobOperationalSummary("), source.indexOf("function renderJobGateCard("));
const job = { id: "job-1", jobId: "J-1", contractorId: "contractor-1", franchiseId: "franchise-1" };

function render({ tasks = [], entries = [], equipment = [] } = {}) {
  const context = vm.createContext({
    state: { equipmentDeployments: equipment },
    visibleTasks: () => tasks,
    visibleTimeEntries: () => entries,
    isEquipmentActive,
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
  });
  vm.runInContext(summary, context);
  return context.renderJobOperationalSummary(job);
}

describe("job operational summary", () => {
  it("joins task assignments, net hours and active equipment for the same job", () => {
    const scope = { contractorId: job.contractorId, franchiseId: job.franchiseId, jobId: job.id };
    const html = render({
      tasks: [{ ...scope, assigneeName: "Crew <Lead>" }],
      entries: [{ ...scope, hours: "1.50" }, { ...scope, hours: "0.25" }],
      equipment: ["Deployed", "Needs pickup", "Returned", "Picked up", "Cancelled"].map((status) => ({ ...scope, status }))
    });
    expect(html).toContain("1 tasks");
    expect(html).toContain("1.75 hours");
    expect(html).toContain("2 / 5 records");
    expect(html).toContain("Crew &lt;Lead>");
  });

  it("does not combine matching job numbers belonging to other contractors or franchises", () => {
    const records = [
      { contractorId: "other", franchiseId: job.franchiseId, job: job.jobId },
      { contractorId: job.contractorId, franchiseId: "other", job: job.jobId },
      { contractorId: job.contractorId, franchiseId: job.franchiseId, job: "another-job" }
    ].map((record) => ({ ...record, relatedJob: record.job, hours: "99", assigneeName: "Other crew", status: "Deployed" }));
    const html = render({ tasks: records, entries: records, equipment: records });
    expect(html).toContain("0 tasks");
    expect(html).toContain("0.00 hours");
    expect(html).toContain("0 / 0 records");
    expect(html).not.toContain("Other crew");
  });
});
