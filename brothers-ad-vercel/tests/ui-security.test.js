import { describe, expect, it } from "vitest";

import { normalizeSectionButtonUrl } from "../ui-security.js";

describe("UI security helpers", () => {
  it("allows exact module routes when the module is available", () => {
    expect(normalizeSectionButtonUrl("#module/jobs", { allowedModuleKeys: ["jobs", "daily"] })).toBe("#module/jobs");
  });

  it("blocks module routes outside the allowed set", () => {
    expect(normalizeSectionButtonUrl("#module/globalindexes", { allowedModuleKeys: ["daily", "jobs"] })).toBe("");
  });

  it("allows HTTPS external links", () => {
    expect(normalizeSectionButtonUrl("https://brothers.ad/path?source=os")).toBe("https://brothers.ad/path?source=os");
  });

  it("blocks executable and non-HTTPS links", () => {
    expect(normalizeSectionButtonUrl("javascript:alert(1)")).toBe("");
    expect(normalizeSectionButtonUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(normalizeSectionButtonUrl("http://brothers.ad")).toBe("");
    expect(normalizeSectionButtonUrl("//evil.example/path")).toBe("");
  });
});
