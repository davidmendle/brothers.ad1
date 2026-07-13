import fs from "fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

describe("pricing workflow", () => {
  it("offers file, paste, sample, and manual pricing inputs", () => {
    expect(source).toContain('data-field="price-csv"');
    expect(source).toContain('data-field="xactimate-import"');
    expect(source).toContain('data-form="pasted-pricing-import"');
    expect(source).toContain('data-action="import-sample-pricing"');
    expect(source).toContain('data-form="price-item"');
    expect(source).toContain('if (type === "pasted-pricing-import")');
    expect(source).toContain('if (action === "import-sample-pricing")');
  });

  it("imports pricing through one linked cross-module record path", () => {
    const importPricingLines = functionBody("importPricingLines");
    expect(importPricingLines).toContain("state.priceItems = [...items, ...state.priceItems]");
    expect(importPricingLines).toContain("state.xactimateImports = [");
    expect(importPricingLines).toContain('linkedModuleKeys: ["defensibility", "payments", "accounting", "revenueengine"]');
    expect(importPricingLines).toContain("applyHighestPricingPolicy()");
  });

  it("uses the linked import path for CSV, pasted, sample, and Xactimate imports", () => {
    expect(functionBody("handlePriceCsvUpload")).toContain("importPricingLines(items, file.name");
    expect(functionBody("importPastedPricing")).toContain("importPricingLines(lines, sourceName");
    expect(functionBody("importSamplePricing")).toContain("importPricingLines(lines, sourceName");
    expect(functionBody("processXactimateFile")).toContain("importPricingLines(lines, file.name");
  });

  it("prevents blank estimate invoices from entering payments", () => {
    const createEstimateInvoice = functionBody("createEstimateInvoice");
    expect(createEstimateInvoice).toContain("if (!lines.length)");
    expect(createEstimateInvoice).toContain("Add at least one estimate line before creating an invoice");
    expect(createEstimateInvoice).toContain('linkedModuleKeys: ["pricing", "accounting", "revenueengine", "defensibility", "jobs"]');
  });

  it("derives global revenue and customer index records from local invoice files", () => {
    expect(functionBody("localRevenueInvoiceRecords")).toContain('source: "local-file"');
    expect(functionBody("revenueInvoices")).toContain("localRevenueInvoiceRecords()");
    expect(functionBody("customerRecords")).toContain("localRevenueInvoiceRecords().forEach");
    expect(source).toContain("Local operating files plus secured defaults");
  });

  it("keeps browser storage quota from making controls feel dead", () => {
    const persist = functionBody("persist");
    expect(persist).toContain("try {");
    expect(persist).toContain("Saved a compact copy after browser storage filled up");
    expect(persist).toContain("Browser storage is full");
  });
});
