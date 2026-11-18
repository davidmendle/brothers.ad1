import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as lifecycle from "../equipment-lifecycle.js";

// Also runnable with node --test when workspace dependencies are not installed.
const { describe, it } = process.env.VITEST ? await import("vitest") : await import("node:test");
const {
  normalizeEquipmentDeployment, returnEquipmentDeployment, normalizeEquipmentBilling,
  equipmentRentalDays, findActiveEquipmentConflict, equipmentJobGate, equipmentMatchesJob
} = lifecycle;
const now = "2026-11-17T12:00:00.000Z";
const actor = { roleId: "business_owner", uid: "owner-1" };
const scope = { companyId: "company-1", franchiseId: "franchise-1", branchId: "branch-1", contractorId: "contractor-1" };
const job = { ...scope, id: "job-1", jobId: "J-1", title: "Water loss", gates: [{ id: "equipment", status: "Open" }, { id: "invoice", status: "Blocked" }] };
const raw = {
  ...scope, id: "EQ-1", equipmentName: "Dehumidifier", assetTag: "DEHU-1", jobId: job.id, job: job.jobId,
  deployedAt: "2026-11-15T12:00:00.000Z", dailyRate: "95.00", billable: true, latitude: "", longitude: ""
};
const make = (changes = {}, who = actor, deployments = []) => normalizeEquipmentDeployment({ ...raw, ...changes }, who, deployments, now);
const returned = (deployment = make(), changes = {}, who = actor) => returnEquipmentDeployment(deployment, { returnedAt: now, ...changes }, who, now);
const rejects = (operation, statusCode = 400) => assert.throws(operation, (error) => error instanceof Error && error.statusCode === statusCode);

describe("equipment lifecycle validation", () => {
  it("creates a scoped versioned deployment with duration pending return and no false zero GPS", () => {
    const result = make({ rentalDays: 0, lifecycleVersion: 99, deployedByUid: "forged" });
    assert.equal(result.lifecycleVersion, 1);
    assert.equal(result.status, "Deployed");
    assert.equal(result.rentalDays, 0);
    assert.equal(result.dailyRate, 95);
    assert.equal(result.deployedByUid, actor.uid);
    assert.equal(result.billingReviewedByUid, actor.uid);
    assert.equal(result.latitude, null);
    assert.equal(result.longitude, null);
    for (const key of Object.keys(scope)) assert.equal(result[key], scope[key]);
  });

  it("requires a job, asset and valid, nonfuture deployment timestamp", () => {
    for (const change of [{ jobId: "" }, { assetTag: " " }, { equipmentName: "" }, { deployedAt: "2026-11-18T12:00:00Z" },
      { deployedAt: "2026-02-30T12:00:00Z" }, { deployedAt: "2026-11-15" }, { deployedAt: "2026-11-15T12:00:00" },
      { deployedAt: "2026-11-15T24:00:00Z" }, { status: "Returned" }, { returnedAt: now }, { rentalDays: 5 }, { invoiceId: "F-1" },
      { latitude: "100", longitude: "20" }, { latitude: "abc", longitude: "20" }, { latitude: "0", longitude: "" }]) rejects(() => make(change));
    assert.equal(make({ latitude: 0, longitude: 0 }).latitude, 0);
  });

  it("blocks normalized active asset tags across jobs and branches, including needs-pickup/repair records", () => {
    for (const status of ["Deployed", "Needs pickup", "Lost / review", "In repair", "Complete"]) {
      rejects(() => make({}, actor, [{ ...make(), id: "EQ-old", branchId: "other", assetTag: " dehu-1 ", status }]), 409);
    }
    assert.ok(findActiveEquipmentConflict([make({ assetTag: "ASSET   1" })], { ...raw, assetTag: "asset 1" }));
    assert.equal(findActiveEquipmentConflict([{ ...make(), contractorId: "other-owner" }], raw), undefined);
    assert.equal(make({}, actor, [returned()]).status, "Deployed");
    assert.equal(make({}, actor, [{ ...make(), status: "Picked up" }]).status, "Deployed");
  });

  it("computes started elapsed 24-hour periods rather than trusting entered rental days", () => {
    const start = "2026-11-15T12:00:00Z";
    assert.equal(equipmentRentalDays(start, start), 1);
    assert.equal(equipmentRentalDays(start, "2026-11-15T12:00:01Z"), 1);
    assert.equal(equipmentRentalDays(start, "2026-11-16T12:00:00Z"), 1);
    assert.equal(equipmentRentalDays(start, "2026-11-16T12:00:00.001Z"), 2);
    assert.equal(equipmentRentalDays("2026-03-07T12:00:00-05:00", "2026-03-08T12:00:00-04:00"), 1);
    assert.equal(returned(make(), { rentalDays: 999 }).rentalDays, 2);
  });

  it("preserves identity, scope, billing and start time on a worker return", () => {
    const stored = { ...make(), invoiceId: "existing-invoice", notes: "Original placement" };
    const result = returned(stored, { id: "forged", jobId: "other", dailyRate: 999, billable: false, invoiceId: "forged", deployedAt: now, ...Object.fromEntries(Object.keys(scope).map((key) => [key, "forged"])) }, { roleId: "worker", uid: "worker-1" });
    for (const key of ["id", "jobId", "invoiceId", "dailyRate", "billable", "deployedAt", "notes", ...Object.keys(scope)]) assert.equal(result[key], stored[key]);
    assert.equal(result.status, "Returned");
    assert.equal(result.returnedByUid, "worker-1");
    assert.equal(result.returnedAt, now);
    assert.equal(stored.status, "Deployed");
  });

  it("allows an exact return retry but rejects redating a closed deployment", () => {
    const closed = returned();
    assert.deepEqual(returned(closed), closed);
    rejects(() => returned(closed, { returnedAt: "2026-11-16T12:00:00Z" }), 409);
    rejects(() => returned(make(), { returnedAt: "2026-11-14T12:00:00Z" }));
    rejects(() => returned(make(), { returnedAt: "2026-11-18T12:00:00Z" }));
  });

  it("upgrades legacy records only on an explicit return and uses their original createdAt", () => {
    const stored = { ...raw, createdAt: raw.deployedAt, status: "Needs pickup", rentalDays: 99 };
    delete stored.deployedAt;
    const result = returned(stored);
    assert.equal(result.lifecycleVersion, 1);
    assert.equal(result.deployedAt, stored.createdAt);
    assert.equal(result.rentalDays, 2);
    assert.equal(stored.lifecycleVersion, undefined);
  });

  it("allows field deployment without billing and rejects field billing forgeries", () => {
    for (const roleId of ["worker", "contractor"]) {
      const worker = { roleId, uid: "worker-1" };
      const result = make({ dailyRate: 0, billable: false }, worker);
      assert.equal(result.billingReviewedAt, undefined);
      for (const change of [{ dailyRate: 95 }, { billable: true }, { invoiceNumber: "INV-1" }]) rejects(() => make({ dailyRate: 0, billable: false, ...change }, worker), 403);
      rejects(() => normalizeEquipmentBilling(result, { dailyRate: 95, billable: true }, worker, now), 403);
    }
    for (const roleId of ["", "admin", "BUSINESS_OWNER"]) rejects(() => make({}, { roleId, uid: "x" }), 403);
  });

  it("validates rate precision and keeps billing edits limited to office billing fields", () => {
    for (const dailyRate of [-1, "", "bad", "0x10", true, Infinity, "1.001", 1.001, 1000001, 0]) {
      rejects(() => normalizeEquipmentBilling(make(), { dailyRate, billable: true }, actor, now));
    }
    const result = normalizeEquipmentBilling(returned(), { dailyRate: "12.50", billable: true, id: "forged", rentalDays: 999, invoiceId: "forged" }, actor, now);
    assert.equal(result.id, raw.id);
    assert.equal(result.rentalDays, 2);
    assert.equal(result.invoiceId, "");
    assert.equal(result.dailyRate, 12.5);
  });

  it("updates only the scoped equipment gate and only closes after all assets return", () => {
    const active = { ...make(), id: "EQ-2", assetTag: "OTHER" };
    assert.equal(equipmentJobGate(job, [returned(), active]).gates[0].status, "Open");
    const done = equipmentJobGate(job, [returned()]);
    assert.equal(done.gates[0].status, "Done");
    assert.equal(done.gates[1].status, "Blocked");
    assert.equal(job.gates[0].status, "Open");
    assert.equal(equipmentMatchesJob({ ...make(), contractorId: "other" }, job), false);
    assert.equal(equipmentMatchesJob({ ...make(), jobId: "other" }, job), false);
    assert.equal(equipmentMatchesJob({ ...make(), jobId: "", job: "J-1 Water loss" }, job), true);
  });
});

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const equipmentFunctions = source.slice(source.indexOf("let equipmentMutationBusy = false;"), source.indexOf("async function clockIn("));
const renderFunctions = source.slice(source.indexOf("function renderEquipmentModule("), source.indexOf("function renderTicketSignoffFeed("));

function runtime(options = {}) {
  let nextId = 0;
  const events = [];
  const state = { authSession: options.actor || actor, equipmentDeployments: [], files: [], jobBoards: [structuredClone(job)], tasks: [], activity: [] };
  let accepted = structuredClone(state);
  const context = vm.createContext({
    ...lifecycle, state, FormData, Date, console, encodeURIComponent,
    document: options.document || { querySelectorAll: () => [] },
    normalizeEquipmentDeployment: (record, who, deployments) => normalizeEquipmentDeployment(record, who, deployments, now),
    returnEquipmentDeployment: (record, changes, who) => returnEquipmentDeployment(record, changes, who, now),
    normalizeEquipmentBilling: (record, changes, who) => normalizeEquipmentBilling(record, changes, who, now),
    createId: (prefix) => `${prefix}-${++nextId}`,
    currentWorkspaceIdentity: () => ({ uid: state.authSession.uid, companyId: scope.companyId }),
    isOfflineSmokePreview: () => false,
    workspaceWritesReady: () => options.ready !== false,
    equipmentCharge: (deployment) => deployment.billable ? Number(deployment.dailyRate) * Number(deployment.rentalDays) : 0,
    applicationScopeForModules: (moduleKey) => ({ applicationId: `app-${moduleKey}` }),
    ensureWorkflowTask: (data) => { const task = { id: `task-${++nextId}`, ...data, status: "Open" }; state.tasks = [task, ...state.tasks]; return task; },
    addActivity: (message) => { state.activity = [message, ...state.activity]; },
    persist: () => events.push("persist"),
    syncWorkspaceState: async () => {
      events.push("saving");
      const result = options.sync ? await options.sync() : { durable: true, ignoredRecords: 0 };
      if (result?.durable && !result.ignoredRecords) accepted = structuredClone(state);
      return result;
    },
    recoverRejectedWorkspaceState: async () => { Object.assign(state, structuredClone(accepted)); events.push("recovered"); },
    setToast: (message) => events.push(message),
    render: () => events.push("render"),
    escapeHtml: (text) => String(text ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    formatTime: (date) => date,
    formatMoney: (amount) => `$${Number(amount || 0).toFixed(2)}`,
    renderModuleFiles: () => "", renderFileDetail: () => "",
    equipmentMapBounds: () => ({}), pinPosition: () => ({ x: 50, y: 50 })
  });
  vm.runInContext(`${equipmentFunctions}\n${renderFunctions}`, context);
  const data = (values) => { const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value); return form; };
  const placement = (change = {}) => data({ equipmentName: raw.equipmentName, assetTag: raw.assetTag, jobId: context.equipmentRecordKey(job),
    deployedAt: context.equipmentLocalDateTime(raw.deployedAt), dailyRate: "95", billable: "on", ...change });
  const returnForm = (deployment) => data({ deploymentId: context.equipmentRecordKey(deployment), returnedAt: context.equipmentLocalDateTime(now), returnNotes: "Returned in good condition" });
  return { context, state, events, data, placement, returnForm };
}

describe("equipment app workflow", () => {
  it("links deploy/return/billing to the same scoped support file, job and invoice", async () => {
    const { context: app, state, placement, returnForm } = runtime();
    await app.addEquipmentDeployment(placement());
    const original = state.equipmentDeployments[0];
    const support = state.files[0];
    assert.equal(support.sourceId, original.id);
    assert.equal(support.jobId, job.id);
    assert.ok(support.linkedModuleKeys.includes("payments"));
    await app.recordEquipmentReturn(returnForm(original));
    assert.equal(state.equipmentDeployments[0].id, original.id);
    assert.equal(state.equipmentDeployments[0].rentalDays, 2);
    assert.equal(state.files.length, 1);
    assert.equal(state.files[0].id, support.id);
    assert.equal(state.files[0].status, "Complete");
    assert.equal(state.files[0].amount, 190);
    assert.equal(state.jobBoards[0].gates[0].status, "Done");
    const key = app.equipmentRecordKey(state.equipmentDeployments[0]);
    await app.createEquipmentInvoice(key);
    const invoiceId = state.equipmentDeployments[0].invoiceId;
    await app.createEquipmentInvoice(key);
    assert.equal(state.files.length, 2);
    assert.equal(state.equipmentDeployments[0].invoiceId, invoiceId);
    assert.equal(state.files.find((file) => file.id === invoiceId).amount, 190);
    assert.equal(state.tasks[0].status, "Complete");
    for (const record of [...state.files, ...state.equipmentDeployments, ...state.tasks]) {
      for (const field of Object.keys(scope)) assert.equal(record[field], scope[field]);
    }
  });

  it("does not acknowledge a pending write or allow a second equipment mutation", async () => {
    let finish;
    const { context: app, state, placement, events } = runtime({ sync: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = app.addEquipmentDeployment(placement());
    assert.deepEqual(events, ["persist", "saving"]);
    await assert.rejects(app.addEquipmentDeployment(placement()), /still saving/);
    assert.equal(state.equipmentDeployments.length, 1);
    finish({ durable: true });
    await pending;
    assert.ok(events.includes("Equipment deployment saved"));
  });

  it("rolls back rejected or partially ignored writes without reporting saved", async () => {
    for (const result of [null, { durable: false }, { durable: true, ignoredRecords: 1 }]) {
      const { context: app, state, placement, events } = runtime({ sync: async () => result });
      await assert.rejects(app.addEquipmentDeployment(placement()), /did not confirm/);
      assert.equal(state.equipmentDeployments.length, 0);
      assert.equal(state.files.length, 0);
      assert.ok(events.includes("recovered"));
      assert.ok(!events.includes("Equipment deployment saved"));
    }
  });

  it("locks equipment controls through pending saves and restores their prior disabled state", async () => {
    for (const durable of [true, false]) {
      let finish;
      let busy = "";
      const controls = [{ disabled: false, isConnected: true }, { disabled: true, isConnected: true }];
      const form = { setAttribute: (_, value) => { busy = value; }, removeAttribute: () => { busy = ""; } };
      const document = { querySelectorAll: (selector) => selector === 'form[data-form^="equipment-"]' ? [form] : controls };
      const { context: app, placement } = runtime({ document, sync: () => new Promise((resolve) => { finish = resolve; }) });
      const pending = app.addEquipmentDeployment(placement());
      assert.equal(busy, "true");
      assert.ok(controls.every((control) => control.disabled));
      const replacement = { disabled: false, isConnected: true };
      controls.push(replacement);
      app.setEquipmentControlsSaving(true);
      assert.equal(replacement.disabled, true);
      finish({ durable });
      if (durable) await pending;
      else await assert.rejects(pending, /did not confirm/);
      assert.deepEqual(controls.map((control) => control.disabled), [false, true, false]);
      assert.equal(busy, "");
    }
  });

  it("restores equipment controls after validation rejects a change before saving", async () => {
    const control = { disabled: false, isConnected: true };
    const document = { querySelectorAll: (selector) => selector === 'form[data-form^="equipment-"]' ? [] : [control] };
    const { context: app, placement } = runtime({ document });
    await assert.rejects(app.addEquipmentDeployment(placement({ jobId: "missing" })), /exact/);
    assert.equal(control.disabled, false);
  });

  it("does not mutate when storage is locked, a job key is forged or an asset is busy", async () => {
    const locked = runtime({ ready: false });
    await assert.rejects(locked.context.addEquipmentDeployment(locked.placement()), /unavailable/);
    assert.equal(locked.state.files.length, 0);
    const { context: app, state, placement } = runtime();
    await assert.rejects(app.addEquipmentDeployment(placement({ jobId: "missing" })), /exact/);
    await app.addEquipmentDeployment(placement());
    await assert.rejects(app.addEquipmentDeployment(placement({ assetTag: " dehu-1 " })), /already active/);
    assert.equal(state.equipmentDeployments.length, 1);
  });

  it("restricts field users to placement and return with no payment mutation", async () => {
    const { context: app, state, data, placement, returnForm } = runtime({ actor: { roleId: "worker", uid: "worker-1" } });
    await assert.rejects(app.addEquipmentDeployment(placement()), /cannot set/);
    await app.addEquipmentDeployment(placement({ dailyRate: "0", billable: "" }));
    await app.recordEquipmentReturn(returnForm(state.equipmentDeployments[0]));
    const key = app.equipmentRecordKey(state.equipmentDeployments[0]);
    await assert.rejects(app.createEquipmentInvoice(key), /Only office/);
    await assert.rejects(app.saveEquipmentBilling(data({ deploymentId: key, dailyRate: 100, billable: "on" })), /Only office/);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.files.length, 1);
    assert.equal(state.jobBoards[0].gates[0].status, "Open");
    assert.equal(state.equipmentDeployments[0].billable, false);
  });

  it("cannot invoice active equipment and cannot overwrite a sent or paid invoice", async () => {
    const { context: app, state, placement, returnForm } = runtime();
    await app.addEquipmentDeployment(placement());
    const key = app.equipmentRecordKey(state.equipmentDeployments[0]);
    await assert.rejects(app.createEquipmentInvoice(key), /Record the equipment return/);
    await app.recordEquipmentReturn(returnForm(state.equipmentDeployments[0]));
    await app.createEquipmentInvoice(key);
    const invoice = state.files.find((file) => file.sourceType === "equipmentInvoice");
    invoice.paymentUrl = "https://pay.example.test/invoice";
    await assert.rejects(app.createEquipmentInvoice(key), /not an editable/);
    assert.equal(state.files.length, 2);
    assert.equal(invoice.paymentUrl, "https://pay.example.test/invoice");
  });

  it("renders role-appropriate forms and stable action selectors", async () => {
    const office = runtime();
    assert.match(office.context.renderEquipmentForm(), /name="jobId"/);
    assert.match(office.context.renderEquipmentForm(), /name="deployedAt"/);
    assert.doesNotMatch(office.context.renderEquipmentForm(), /name="rentalDays"/);
    await office.context.addEquipmentDeployment(office.placement());
    const activeCard = office.context.renderEquipmentDeploymentCard(office.state.equipmentDeployments[0]);
    assert.match(activeCard, /data-form="equipment-return"/);
    assert.doesNotMatch(activeCard, /data-action="create-equipment-invoice"/);
    await office.context.recordEquipmentReturn(office.returnForm(office.state.equipmentDeployments[0]));
    const returnedCard = office.context.renderEquipmentDeploymentCard(office.state.equipmentDeployments[0]);
    assert.match(returnedCard, /data-form="equipment-billing"/);
    assert.match(returnedCard, /data-action="create-equipment-invoice"/);
    assert.doesNotMatch(returnedCard, /data-form="equipment-return"/);
    const worker = runtime({ actor: { roleId: "worker", uid: "worker-1" } });
    assert.doesNotMatch(worker.context.renderEquipmentForm(), /name="dailyRate"|name="billable"|name="invoiceNumber"/);
    assert.doesNotMatch(worker.context.renderEquipmentDeploymentCard(returned()), /equipment-billing|create-equipment-invoice/);
  });
});
