import fs from "fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function uniqueMatches(pattern) {
  return Array.from(new Set([...source.matchAll(pattern)].map((match) => match[1]))).sort();
}

function tagAttributes(pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe("UI action inventory", () => {
  it("handles every rendered data-action value", () => {
    const renderedActions = uniqueMatches(/data-action=\"([^\"]+)\"/g);
    const directHandlers = uniqueMatches(/if \(action === \"([^\"]+)\"\)/g);
    const groupedHandlers = [...source.matchAll(/if \(([^)]*action ===[^)]*)\)/g)]
      .flatMap((match) => [...match[1].matchAll(/action === \"([^\"]+)\"/g)].map((item) => item[1]));
    const handledActions = Array.from(new Set([...directHandlers, ...groupedHandlers])).sort();
    const missing = renderedActions.filter((action) => !handledActions.includes(action));

    expect(renderedActions.length).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it("handles every rendered data-form value", () => {
    const renderedForms = uniqueMatches(/data-form=\"([^\"]+)\"/g);
    const handledForms = uniqueMatches(/if \(type === \"([^\"]+)\"\)/g);
    const missing = renderedForms.filter((form) => !handledForms.includes(form));

    expect(renderedForms.length).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });

  it("does not render inert buttons", () => {
    const renderedButtons = [...source.matchAll(/<button\b([^>]*)>/g)].map((match) => match[1]);
    const inertButtons = renderedButtons.filter((attributes) => !/data-action=/.test(attributes) && !/type=\"submit\"/.test(attributes));

    expect(renderedButtons.length).toBeGreaterThan(100);
    expect(inertButtons).toEqual([]);
  });

  it("keeps rendered buttons accessible by text or aria-label", () => {
    const renderedButtons = [...source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const unlabeledButtons = renderedButtons
      .filter(([, attributes, body]) => {
        const bodySource = String(body || "");
        const visibleOrDynamicText = bodySource.replace(/<[^>]+>/g, "").trim() || bodySource.includes("${");
        return !/aria-label=/.test(attributes) && !visibleOrDynamicText;
      })
      .map(([, attributes]) => attributes.trim());

    expect(renderedButtons.length).toBeGreaterThan(100);
    expect(unlabeledButtons).toEqual([]);
  });

  it("renders role permissions from each role's own permission document", () => {
    expect(source).toContain("function renderRolePermissionForms(editableRoles, permissionDocs)");
    expect(source).toContain("rolePermissionsFor(permissionDocs, role.id)");
    expect(source).not.toContain("editableRoles[0]");
  });

  it("keeps the local employee builder available when Firebase auth is active", () => {
    expect(source).toContain("Secure login manager is active");
    expect(source).toContain("state.firebase.enabled && state.authSession");
    expect(source).toContain("${renderTeamForm()}");
  });

  it("keeps module anchors wired through the router", () => {
    const moduleAnchors = tagAttributes(/<a\b([^>]*href=\"#module\/[^>]*)>/g);
    const unhandledAnchors = moduleAnchors.filter((attributes) => !/data-action=\"set-active\"/.test(attributes) || !/data-key=/.test(attributes));

    expect(moduleAnchors.length).toBeGreaterThan(40);
    expect(unhandledAnchors).toEqual([]);
  });

  it("filters admin-authored navigation and section URLs through shared guards", () => {
    expect(source).toContain('import { normalizeSectionButtonUrl } from "./ui-security.js";');
    expect(source).toContain("function renderModuleButton(key, fallback = \"\")");
    expect(source).toContain("function renderModuleTextLink(key, fallback = \"\", className = \"text-link\")");
    expect(source).toContain("normalizeSectionButtonUrl(button.url, { allowedModuleKeys })");
    expect(source).toContain("normalizeSectionButtonUrl(rawButtonUrl, { allowedModuleKeys: modules.map((module) => module.key) })");
  });

  it("keeps the communication board and global index modules routable", () => {
    expect(source).toContain('if (module.key === "communications") return renderCommunicationsModule(module);');
    expect(source).toContain('if (module.key === "globalindexes") return renderGlobalIndexesModule(module);');
    expect(source).toContain('function renderGlobalBusinessIndexPanel()');
    expect(source).toContain('function renderCommunityPost(post)');
  });
});
