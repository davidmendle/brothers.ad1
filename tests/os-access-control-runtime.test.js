import { describe, expect, it } from "vitest";
import accessControl from "../lib/os-access-control.js";

const {
  buildSeedTabsPagesSections,
  parseModuleDefinitions
} = accessControl;

describe("OS access-control runtime catalog", () => {
  it("loads the module catalog without a runtime filesystem lookup", () => {
    const modules = parseModuleDefinitions();
    const seeds = buildSeedTabsPagesSections();

    expect(modules).toHaveLength(70);
    expect(modules[0]).toMatchObject({
      key: "daily",
      label: "Daily Owner Dashboard"
    });
    expect(seeds.tabs).toHaveLength(modules.length);
    expect(seeds.pages).toHaveLength(modules.length);
    expect(seeds.sections.length).toBeGreaterThan(modules.length);
  });

  it("returns fresh module objects so request hydration cannot mutate the shared catalog", () => {
    const firstRead = parseModuleDefinitions();
    firstRead[0].label = "Changed";

    expect(parseModuleDefinitions()[0].label).toBe("Daily Owner Dashboard");
  });
});
