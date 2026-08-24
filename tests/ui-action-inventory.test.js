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

  it("keeps the employee profile builder and non-employee access manager available", () => {
    expect(source).toContain("Add employee profile");
    expect(source).toContain("Secure storage needs activation");
    expect(source).toContain("${renderEmployeeInvitationPanel()}");
    expect(source).toContain("${renderTeamForm()}");
  });

  it("keeps module anchors wired through the router", () => {
    const moduleAnchors = tagAttributes(/<a\b([^>]*href=\"#module\/[^>]*)>/g);
    const unhandledAnchors = moduleAnchors.filter((attributes) => !/data-action=\"set-active\"/.test(attributes) || !/data-key=/.test(attributes));

    expect(moduleAnchors.length).toBeGreaterThan(40);
    expect(unhandledAnchors).toEqual([]);
  });

  it("uses structured cross-module records instead of file-only workbench submissions", () => {
    expect(source).toContain('moduleRecords: []');
    expect(source).toContain('state.moduleRecords = [record, ...(state.moduleRecords || [])]');
    expect(source).toContain('sourceType: "moduleRecord"');
    expect(source).toContain("function moduleRecordsFor(moduleKey)");
    expect(source).toContain("function updateModuleRecordStatus(recordId, status)");
  });

  it("locks operational writes when shared Firebase storage is unavailable", () => {
    expect(source).toContain("function workspaceWritesReady()");
    expect(source).toContain("durableMutationActions.has(action) && !workspaceWritesReady()");
    expect(source).toContain('type !== "access-request" && !workspaceWritesReady()');
    expect(source).toContain("This prevents browser-only data from appearing saved");
    expect(source).toContain("persistence.loaded");
    expect(source).toContain("persistence.durable");
    expect(source).toContain("workspaceIdentityMatchesCurrent()");
    expect(source).toContain("resetWorkspaceForCurrentSession(runtimeState)");
  });

  it("keeps photo evidence separate from GPS-backed ticket completion", () => {
    const photoWorkflow = source.slice(
      source.indexOf("async function addPhotoEvidence"),
      source.indexOf("function addJobNote")
    );
    expect(photoWorkflow).not.toContain("completeTask(task.id)");
    expect(photoWorkflow).toContain("sign the ticket with GPS to complete it");
    expect(source).toContain('apiRequest("/api/employee/ticket-signoffs"');
  });

  it("keeps employee mutations aligned with server authorization", () => {
    const profileSave = source.slice(
      source.indexOf("async function saveEmployeeProfile"),
      source.indexOf("async function submitTicketSignoff")
    );
    const photoWorkflow = source.slice(
      source.indexOf("async function addPhotoEvidence"),
      source.indexOf("function addJobNote")
    );
    expect(source).toContain("fieldUserEditableWorkspaceFields");
    expect(source).toContain("baseRevision: state.workspacePersistence.revision");
    expect(source).toContain("baseUpdatedAt: state.workspacePersistence.lastSavedAt");
    expect(source).toContain('currentRoleId() === "worker"');
    expect(source).toContain("Sign with GPS");
    expect(source).toContain("ownerManagedJobGateIds");
    expect(source).toContain("canEditModuleWorkflowRecords()");
    expect(profileSave).not.toContain("employmentType:");
    expect(profileSave).not.toContain("startDate:");
    expect(photoWorkflow.indexOf("await syncWorkspaceState({ force: true })"))
      .toBeLessThan(photoWorkflow.indexOf("Photo evidence saved"));
  });

  it("hides server-rejected employee controls and restores rejected workspace writes", () => {
    expect(source).toContain('const canCreateJobs = currentRoleId() !== "worker";');
    expect(source).toContain("function canEditFileRecord(file)");
    expect(source).toContain('sourceType || "").trim().toLowerCase() === "taskassignment"');
    expect(source).toContain("async function recoverRejectedWorkspaceState(error)");
    expect(source).toContain("await hydrateWorkspaceState({ migrateIfEmpty: false, preserveLocalOnError: true })");
    expect(source).toContain('input name="photoFile" type="file" accept="image/*" required');
    expect(source).not.toContain("Photo reference or link");
  });

  it("routes every advertised relationship to a real module and renders real account pages", () => {
    for (const removedKey of ["branchbench", "signature", "dashboard"]) {
      expect(source).not.toContain(`\"${removedKey}\"`);
    }
    expect(source).toContain('fieldmobile: ["time", "photos", "equipment", "safetyintel"]');
    expect(source).toContain('if (module.key === "settings") return renderSettingsModule(module);');
    expect(source).toContain('if (module.key === "securitycenter") return renderSecurityCenterModule(module);');
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

  it("uses Google-only authentication in the browser UI", () => {
    expect(source).toContain("loginWithFirebaseGoogle");
    expect(source).not.toContain("loginWithFirebasePassword");
    expect(source).not.toContain('data-form="firebase-login"');
    expect(source).not.toContain('data-form="insurance-admin-login"');
  });

  it("provides operational contractor invoice and shared photo workflows", () => {
    expect(source).toContain('data-form="contractor-invoice"');
    expect(source).toContain("function addContractorInvoice(formData)");
    expect(source).toContain('apiRequest("/api/workspace-assets"');
    expect(source).toContain("photoUrl: uploadedAsset?.assetUrl");
  });
});
