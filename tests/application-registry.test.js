import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const moduleDefinitions = require("../module-data.js");
const {
  areApplicationsConnected,
  getApplicationForModule,
  getApplications,
  getModuleKeysForApplicationIds,
  resolveWorkspaceFilePrimaryModule,
  summarizeApplicationAccess,
  validateApplicationRegistry
} = require("../application-registry.js");
const {
  buildAccessibleApplications,
  deriveApplicationAccess,
  deriveEffectiveApplicationAccess,
  getSystemPermissions
} = require("../lib/os-access-control.js");

describe("Brothers OS application registry", () => {
  it("assigns every module to exactly one bounded application", () => {
    const validation = validateApplicationRegistry(moduleDefinitions);

    expect(validation).toEqual({
      ok: true,
      errors: [],
      applicationCount: 8,
      moduleCount: moduleDefinitions.length,
      contractVersion: 1
    });
  });

  it("provides a reusable General Contracting application", () => {
    const generalContracting = getApplications().find((application) => application.id === "general-contracting");

    expect(generalContracting.defaultModuleKey).toBe("jobs");
    expect(generalContracting.moduleKeys).toEqual(expect.arrayContaining([
      "jobs", "workorders", "dispatch", "time", "equipment", "photos", "sketch", "closeout", "warranty"
    ]));
    expect(generalContracting.connections.map((connection) => connection.applicationId)).toEqual(expect.arrayContaining([
      "workforce", "restoration-claims", "finance-and-reporting", "contractor-network"
    ]));
  });

  it("expands application grants into explicit module grants", () => {
    const moduleKeys = getModuleKeysForApplicationIds(["workforce", "finance-and-reporting"]);

    expect(moduleKeys).toEqual(expect.arrayContaining(["team", "training", "payments", "accounting", "reports"]));
    expect(moduleKeys).not.toContain("globalindexes");
  });

  it("permits links only within an application or a declared application connection", () => {
    expect(areApplicationsConnected("general-contracting", "finance-and-reporting")).toBe(true);
    expect(areApplicationsConnected("communications-intelligence", "general-contracting")).toBe(true);
    expect(areApplicationsConnected("workforce", "restoration-claims")).toBe(false);
  });

  it("distinguishes full and partial application access", () => {
    const access = summarizeApplicationAccess(["team", "training", "sops", "certbadge", "payments"]);
    const workforce = access.find((entry) => entry.applicationId === "workforce");
    const finance = access.find((entry) => entry.applicationId === "finance-and-reporting");

    expect(workforce.mode).toBe("full");
    expect(finance.mode).toBe("partial");
    expect(finance.allowedModuleKeys).toEqual(["payments"]);
    expect(getApplicationForModule("payments").id).toBe("finance-and-reporting");
  });

  it("resolves canonical file ownership identically for browser and server consumers", () => {
    expect(resolveWorkspaceFilePrimaryModule({ sourceType: "jobNote", moduleKey: "globalindexes" })).toBe("jobs");
    expect(resolveWorkspaceFilePrimaryModule({
      sourceType: "taskAssignment",
      moduleKey: "team",
      taskModuleKey: "retired-task-module"
    })).toBe("retired-task-module");
    expect(resolveWorkspaceFilePrimaryModule({ moduleKey: "team" })).toBe("team");
  });

  it("derives application access from modules without widening the role", () => {
    const derived = deriveApplicationAccess(["jobs", "photos", "team"]);
    const workerApplications = buildAccessibleApplications(
      getSystemPermissions().worker,
      ["jobs", "photos", "globalindexes"]
    );

    expect(derived.visibleApplicationIds).toEqual(["general-contracting", "workforce"]);
    expect(workerApplications.map((application) => application.id)).toEqual(["general-contracting"]);
    expect(workerApplications[0].access.allowedModuleKeys).toEqual(["jobs", "photos"]);

    const storedWorkerAccess = deriveEffectiveApplicationAccess(
      getSystemPermissions().worker,
      ["jobs", "photos", "globalindexes"]
    );
    const defaultWorkerAccess = deriveEffectiveApplicationAccess(getSystemPermissions().worker, []);
    expect(storedWorkerAccess.visibleApplicationIds).toEqual(["general-contracting"]);
    expect(defaultWorkerAccess.visibleApplicationIds).toEqual(expect.arrayContaining([
      "general-contracting", "restoration-claims", "communications-intelligence"
    ]));
  });
});
