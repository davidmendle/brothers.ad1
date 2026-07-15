import fs from "fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

describe("cross-module workflow linkage", () => {
  it("makes linked files visible in every related module", () => {
    expect(source).toContain("function normalizeModuleKeyList");
    expect(source).toContain("function fileBelongsToModule");
    expect(functionBody("filesForModule")).toContain("fileBelongsToModule(file, key)");
    expect(functionBody("renderFileDetail")).toContain("fileBelongsToModule(item, module.key)");
    expect(source).toContain("renderFileLinkedModuleChips(file)");
  });

  it("stores source metadata and linked modules on every created file", () => {
    const createFile = functionBody("createFile");
    expect(createFile).toContain("linkedModuleKeys");
    expect(createFile).toContain("sourceType");
    expect(createFile).toContain("sourceId");
    expect(createFile).toContain("customer");
    expect(createFile).toContain("amount");
  });

  it("turns a new job into payment, equipment, dry log, photo, and time handoffs", () => {
    const addJobRecord = functionBody("addJobRecord");
    expect(addJobRecord).toContain("linkedModuleKeys: job.linkedModules");
    expect(addJobRecord).toContain('moduleKey: "photos"');
    expect(addJobRecord).toContain('moduleKey: "drylogs"');
    expect(addJobRecord).toContain('moduleKey: "equipment"');
    expect(addJobRecord).toContain('moduleKey: "time"');
    expect(addJobRecord).toContain('moduleKey: "payments"');
  });

  it("links revenue workflows into accounting, payment, pricing, and defensibility review", () => {
    const estimateInvoice = functionBody("createEstimateInvoice");
    const paymentRequest = functionBody("createPaymentRequest");
    expect(estimateInvoice).toContain('linkedModuleKeys: ["pricing", "accounting", "revenueengine", "defensibility", "jobs"]');
    expect(estimateInvoice).toContain('moduleKey: "accounting"');
    expect(estimateInvoice).toContain('moduleKey: "defensibility"');
    expect(paymentRequest).toContain('linkedModuleKeys: ["accounting", "revenueengine", "jobs", "relationships"]');
  });

  it("links field evidence into billing and closeout modules", () => {
    const addDryLogRecord = functionBody("addDryLogRecord");
    const addEquipmentDeployment = functionBody("addEquipmentDeployment");
    const clockOut = functionBody("clockOut");
    expect(addDryLogRecord).toContain('linkedModuleKeys: ["jobs", "equipment", "payments", "photos", "defensibility", "evidencechain"]');
    expect(addEquipmentDeployment).toContain('moduleKey: "equipment"');
    expect(addEquipmentDeployment).toContain('linkedModuleKeys: ["jobs", "drylogs", "payments", "photos", "time"]');
    expect(addEquipmentDeployment).toContain('moduleKey: "payments"');
    expect(clockOut).toContain('linkedModuleKeys: ["jobs", "payments", "reports", "closeout", "photos"]');
  });

  it("uses the real current browser date for new operating records", () => {
    expect(source).toContain("const today = new Date();");
    expect(source).not.toContain('const today = new Date("2026-06-06T09:00:00");');
  });

  it("formats date-only deadlines without UTC day shifting", () => {
    const formatDate = functionBody("formatDate");
    expect(formatDate).toContain('text.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/)');
    expect(formatDate).toContain("new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))");
  });

  it("renders communication board posts and comments immediately after API success", () => {
    expect(source).toContain("function mergeCommunityComment");
    expect(functionBody("createCommunityPost")).toContain("state.communityPosts = mergeById([result.post], state.communityPosts || [])");
    expect(functionBody("addCommunityComment")).toContain("mergeCommunityComment(postId, result.comment)");
    expect(functionBody("addCommunityComment")).toContain("usedLocalFallback || updatedFromApi");
  });
});
