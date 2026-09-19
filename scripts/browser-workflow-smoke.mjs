import { chromium } from "playwright";
import fs from "node:fs";

const baseUrl = process.env.BROTHERS_OS_BASE_URL || "http://127.0.0.1:4198";
const origin = new URL(baseUrl).origin;
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const moduleDataSource = fs.readFileSync(new URL("../module-data.js", import.meta.url), "utf8");
const smokeModuleDefinitions = JSON.parse(moduleDataSource.slice(moduleDataSource.indexOf("["), moduleDataSource.lastIndexOf("]") + 1));
const staticActionTypes = [...new Set([...appSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]))].sort();
const staticFormTypes = [...new Set([...appSource.matchAll(/data-form="([^"]+)"/g)].map((match) => match[1]))].sort();
const staticFieldTypes = [...new Set([...appSource.matchAll(/data-field="([^"]+)"/g)].map((match) => match[1]))].sort();
const stamp = String(Date.now()).slice(-6);
const ids = {
  jobId: `J-AI-${stamp}`,
  jobTitle: `AI workflow water loss ${stamp}`,
  customer: `AI Test Customer ${stamp}`,
  employeeName: `AI Test Tech ${stamp}`,
  employeeEmail: `ai.tech.${stamp}@example.com`,
  accessCode: `EMP${stamp}`,
  taskTitle: `Upload kitchen invoice photos ${stamp}`,
  moduleRecord: `Emergency dispatch record ${stamp}`,
  priceCode: `AI-LAB-${stamp}`,
  priceName: `AI labor line ${stamp}`,
  paymentCustomer: `AI Payment Customer ${stamp}`,
  sketchRoom: `AI Office ${stamp}`,
  sketchSeparateRoom: `AI Utility ${stamp}`,
  dryRoom: `Kitchen ${stamp}`,
  photoRef: `IMG-AI-${stamp}.jpg`,
  equipmentName: `AI Dehumidifier ${stamp}`,
  assetTag: `DH-AI-${stamp}`
};

const results = {
  baseUrl,
  ids,
  modulesChecked: 0,
  buttonsRendered: 0,
  formsRendered: 0,
  workbenchFormsSubmitted: 0,
  actionTypesExercised: 0,
  formTypesSubmitted: 0,
  fieldTypesExercised: 0,
  workflowChecks: []
};
const actionCoverage = {
  rendered: new Set(),
  exercised: new Set(),
  formsRendered: new Set(),
  formsSubmitted: new Set(),
  fieldsRendered: new Set(),
  fieldsExercised: new Set(),
  actionLocations: new Map(),
  formLocations: new Map(),
  fieldLocations: new Map()
};
const semanticModuleRecords = [];
const smokePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function moduleUrl(key) {
  return `${baseUrl}/?smoke=${Date.now()}#module/${key}`;
}

async function unique(locator, label) {
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`${label} matched ${count} elements`);
  }
  return locator;
}

async function go(page, key) {
  const expectedLabel = smokeModuleDefinitions.find((module) => module.key === key)?.label || key;
  const canUseSpaNavigation = page.url().startsWith(origin)
    && await page.locator(".app-shell").count().catch(() => 0);
  if (canUseSpaNavigation) {
    await page.evaluate((moduleKey) => {
      window.location.hash = `module/${moduleKey}`;
    }, key);
  } else {
    await page.goto(moduleUrl(key), { waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector(".app-shell", { timeout: 8000 });
  await page.waitForURL((url) => url.hash === `#module/${key}`, { timeout: 8000 });
  await waitUntil(`${key} module DOM`, async () => {
    const heading = await page.locator("h1").textContent().catch(() => "");
    return String(heading || "").trim() === expectedLabel;
  }, 8000);
  const h1 = await page.locator("h1").textContent().catch(() => "");
  if (!h1) throw new Error(`Module ${key} did not render a workspace heading`);
}

async function fill(page, selector, value) {
  await (await unique(page.locator(selector), selector)).fill(String(value));
}

async function select(page, selector, value) {
  await (await unique(page.locator(selector), selector)).selectOption(String(value));
}

async function click(page, selector) {
  const locator = await unique(page.locator(selector), selector);
  const metadata = await locator.evaluate((element) => ({
    action: element.dataset.action || "",
    form: element.closest("form[data-form]")?.dataset.form || ""
  }));
  await locator.click();
  if (metadata.action) actionCoverage.exercised.add(metadata.action);
  if (metadata.form) actionCoverage.formsSubmitted.add(metadata.form);
}

async function clickAny(page, selector, label) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (!count) throw new Error(`${label || selector} matched 0 elements`);
  const first = await firstVisible(locator);
  if (!first) throw new Error(`${label || selector} matched ${count} hidden elements`);
  const metadata = await first.evaluate((element) => ({
    action: element.dataset.action || "",
    form: element.closest("form[data-form]")?.dataset.form || ""
  }));
  await first.click();
  if (metadata.action) actionCoverage.exercised.add(metadata.action);
  if (metadata.form) actionCoverage.formsSubmitted.add(metadata.form);
}

async function expectBody(page, label, text) {
  await page.locator("body").filter({ hasText: text }).waitFor({ state: "visible", timeout: 8000 });
  results.workflowChecks.push({ label, text });
}

async function waitUntil(label, predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function firstVisible(locator) {
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

function recordFieldCoverage(fieldType, location, exercised = false) {
  if (!fieldType) return;
  actionCoverage.fieldsRendered.add(fieldType);
  if (exercised) actionCoverage.fieldsExercised.add(fieldType);
  if (!actionCoverage.fieldLocations.has(fieldType)) actionCoverage.fieldLocations.set(fieldType, location);
}

async function visibleDataField(page, fieldType, location = fieldType) {
  const field = await firstVisible(page.locator(`[data-field="${fieldType}"]`));
  if (!field) throw new Error(`${location} did not render the ${fieldType} data field`);
  recordFieldCoverage(fieldType, location);
  return field;
}

async function exerciseDataField(page, fieldType, operation, location = fieldType) {
  const field = await visibleDataField(page, fieldType, location);
  await operation(field);
  recordFieldCoverage(fieldType, location, true);
  return field;
}

async function setGpsDenied(page, denied) {
  await page.evaluate((shouldDeny) => {
    const geolocation = navigator.geolocation;
    if (!geolocation) throw new Error("Browser geolocation API is unavailable");
    if (!window.__brothersSmokeOriginalGetCurrentPosition) {
      window.__brothersSmokeOriginalGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
    }
    const getCurrentPosition = shouldDeny
      ? (_success, failure) => failure?.({ code: 1, message: "Geolocation permission denied by smoke test" })
      : window.__brothersSmokeOriginalGetCurrentPosition;
    Object.defineProperty(geolocation, "getCurrentPosition", {
      configurable: true,
      value: getCurrentPosition
    });
  }, denied);
}

async function collectPageCoverage(page, key) {
  const summary = await page.evaluate(() => ({
    buttons: document.querySelectorAll("button").length,
    forms: document.querySelectorAll("form[data-form]").length,
    actions: [...new Set([...document.querySelectorAll("[data-action]")].map((element) => element.dataset.action).filter(Boolean))],
    formTypes: [...new Set([...document.querySelectorAll("form[data-form]")].map((element) => element.dataset.form).filter(Boolean))],
    fieldTypes: [...new Set([...document.querySelectorAll("[data-field]")].map((element) => element.dataset.field).filter(Boolean))],
    inertButtons: [...document.querySelectorAll("button")]
      .filter((button) => !button.disabled && !button.dataset.action && !button.dataset.emergencyAction && !button.closest("form"))
      .map((button) => button.textContent.trim().replace(/\s+/g, " "))
      .filter(Boolean)
  }));
  if (summary.inertButtons.length) {
    throw new Error(`Module ${key} rendered inert buttons: ${summary.inertButtons.join(", ")}`);
  }
  summary.actions.forEach((action) => {
    actionCoverage.rendered.add(action);
    if (!actionCoverage.actionLocations.has(action)) actionCoverage.actionLocations.set(action, key);
  });
  summary.formTypes.forEach((formType) => {
    actionCoverage.formsRendered.add(formType);
    if (!actionCoverage.formLocations.has(formType)) actionCoverage.formLocations.set(formType, key);
  });
  summary.fieldTypes.forEach((fieldType) => recordFieldCoverage(fieldType, key));
  return summary;
}

async function safeModuleSweep(page) {
  await go(page, "daily");
  const moduleKeys = await page.evaluate(() => {
    return [...new Set([...document.querySelectorAll('a[href^="#module/"], [data-action="set-active"][data-key]')]
      .map((element) => element.dataset.key || (element.getAttribute("href") || "").replace("#module/", ""))
      .filter(Boolean))];
  });
  for (const key of moduleKeys) {
    await go(page, key);
    const summary = await collectPageCoverage(page, key);
    results.modulesChecked += 1;
    results.buttonsRendered += summary.buttons;
    results.formsRendered += summary.forms;

    const workbench = page.locator('form[data-form="module-workbench"]');
    if (await workbench.count()) {
      const subject = `AI ${key} workbench ${stamp}`;
      await fill(page, 'form[data-form="module-workbench"] input[name="subject"]', subject);
      await click(page, 'form[data-form="module-workbench"] button[type="submit"]');
      await expectBody(page, `${key} workbench submitted`, subject);
      results.workbenchFormsSubmitted += 1;
    }
  }
  return moduleKeys;
}

async function sidebarModuleKeys(page) {
  return page.locator(".sidebar .nav-list .nav-button").evaluateAll((links) => {
    return links.map((link) => link.dataset.key).filter(Boolean);
  });
}

async function exerciseDataFieldControls(page) {
  console.log("[smoke] starting data-field control verification");
  await go(page, "daily");

  const unfilteredModuleCount = (await sidebarModuleKeys(page)).length;
  await exerciseDataField(page, "search", (field) => field.fill("Global Indexes"), "module search");
  await waitUntil("module search result", async () => {
    const keys = await sidebarModuleKeys(page);
    return keys.length === 1 && keys[0] === "globalindexes";
  });
  const resetSearch = await visibleDataField(page, "search", "module search reset");
  await resetSearch.fill("");
  await waitUntil("module search reset", async () => (await sidebarModuleKeys(page)).length === unfilteredModuleCount);

  const categoryField = await visibleDataField(page, "category", "module category filter");
  const category = await categoryField.locator("option").evaluateAll((options, definitions) => {
    const available = options.map((option) => option.value).filter((value) => value && value !== "all");
    return available.find((value) => definitions.filter((module) => module.category === value).length > 1) || available[0] || "";
  }, smokeModuleDefinitions);
  if (!category) throw new Error("Module category filter did not expose a category option");
  await exerciseDataField(page, "category", (field) => field.selectOption(category), "module category filter");
  await waitUntil("module category results", async () => {
    const keys = await sidebarModuleKeys(page);
    return keys.length > 0 && keys.every((key) => smokeModuleDefinitions.find((module) => module.key === key)?.category === category);
  });
  const resetCategory = await visibleDataField(page, "category", "module category reset");
  await resetCategory.selectOption("all");
  await waitUntil("module category reset", async () => (await sidebarModuleKeys(page)).length === unfilteredModuleCount);

  const industryField = await visibleDataField(page, "industry-profile", "industry profile selector");
  const industrySelection = await industryField.locator("option").evaluateAll((options, currentValue) => {
    const alternative = options.find((option) => option.value && option.value !== currentValue);
    const current = options.find((option) => option.value === currentValue);
    return {
      originalValue: currentValue,
      alternativeValue: alternative?.value || "",
      alternativeLabel: alternative?.textContent?.trim() || "",
      originalLabel: current?.textContent?.trim() || ""
    };
  }, await industryField.inputValue());
  if (!industrySelection.alternativeValue) throw new Error("Industry profile selector did not expose an alternate profile");
  await exerciseDataField(page, "industry-profile", (field) => field.selectOption(industrySelection.alternativeValue), "industry profile selector");
  await waitUntil("industry profile update", async () => {
    const field = await firstVisible(page.locator('[data-field="industry-profile"]'));
    const banner = await page.locator(".trial-banner").first().textContent().catch(() => "");
    return field && await field.inputValue() === industrySelection.alternativeValue && banner.includes(industrySelection.alternativeLabel);
  });
  const restoreIndustry = await visibleDataField(page, "industry-profile", "industry profile reset");
  await restoreIndustry.selectOption(industrySelection.originalValue);
  await waitUntil("industry profile reset", async () => {
    const banner = await page.locator(".trial-banner").first().textContent().catch(() => "");
    return banner.includes(industrySelection.originalLabel);
  });

  await go(page, "insurance");
  const insuranceCustomer = `Insurance Customer ${stamp}`;
  await page.locator(".insurance-card").filter({ hasText: insuranceCustomer }).waitFor({ state: "visible" });
  await exerciseDataField(page, "insurance-search", (field) => field.fill(insuranceCustomer), "insurance search");
  await exerciseDataField(page, "insurance-status", (field) => field.selectOption("completed"), "insurance status filter");
  await clickVisibleAction(page, "refresh-insurance-intake", "apply insurance filters");
  await waitUntil("empty insurance filter result", async () => {
    return await page.locator(".insurance-card").count() === 0
      && (await page.locator("body").innerText()).includes("No insurance submissions found");
  });
  const newStatus = await visibleDataField(page, "insurance-status", "insurance status reset");
  await newStatus.selectOption("new");
  recordFieldCoverage("insurance-status", "insurance status filter", true);
  await clickVisibleAction(page, "refresh-insurance-intake", "apply matching insurance filters");
  await page.locator(".insurance-card").filter({ hasText: insuranceCustomer }).waitFor({ state: "visible" });
  const clearInsuranceSearch = await visibleDataField(page, "insurance-search", "insurance search reset");
  await clearInsuranceSearch.fill("");
  const clearInsuranceStatus = await visibleDataField(page, "insurance-status", "insurance status reset");
  await clearInsuranceStatus.selectOption("all");
  await clickVisibleAction(page, "refresh-insurance-intake", "clear insurance filters");
  await page.locator(".insurance-card").filter({ hasText: insuranceCustomer }).waitFor({ state: "visible" });

  await go(page, "pricing");
  const csvCode = `FIELD-CSV-${stamp}`;
  const csv = `code,name,category,unit,rate,cost,branch,justification\n${csvCode},Field coverage labor,Labor,hour,151,61,Smoke branch,Semantic CSV field verification`;
  await exerciseDataField(page, "price-csv", (field) => field.setInputFiles({
    name: `field-price-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  }), "price CSV upload");
  await page.locator(".price-table").filter({ hasText: csvCode }).waitFor({ state: "visible" });

  const xactimateCode = `FIELD-XM8-${stamp}`;
  const xactimateCsv = `code,name,category,unit,rate,cost,branch,justification\n${xactimateCode},Field coverage Xactimate line,Xactimate pricing,each,225,80,Smoke branch,Semantic Xactimate field verification`;
  await exerciseDataField(page, "xactimate-import", (field) => field.setInputFiles({
    name: `field-xactimate-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(xactimateCsv)
  }), "Xactimate upload");
  await page.locator(".price-table").filter({ hasText: xactimateCode }).waitFor({ state: "visible" });

  await exerciseDataField(page, "estimate-logo", (field) => field.setInputFiles({
    name: `field-logo-${stamp}.png`,
    mimeType: "image/png",
    buffer: smokePng
  }), "estimate logo upload");
  await waitUntil("estimate logo preview", async () => {
    const source = await page.locator('img[alt="Logo preview"]').getAttribute("src").catch(() => "");
    return String(source || "").startsWith("data:image/png");
  });

  await go(page, "accessadmin");
  if (!await clickVisibleAction(page, "open-admin-edit", "open admin editor for image upload")) {
    throw new Error("Admin edit mode did not expose its image field");
  }
  await exerciseDataField(page, "admin-image-file", (field) => field.setInputFiles({
    name: `field-admin-${stamp}.png`,
    mimeType: "image/png",
    buffer: smokePng
  }), "admin section image upload");
  await waitUntil("admin image URL handoff", async () => {
    const imageUrl = await page.locator('form[data-form="page-section-config"] input[name="imageUrl"]').inputValue().catch(() => "");
    return imageUrl.includes("logo.png") || imageUrl.includes("workspace-assets");
  });
  await clickVisibleAction(page, "close-modal", "close admin editor after image verification");

  results.workflowChecks.push({
    label: "Data-field controls",
    text: "module filters, insurance filters, pricing imports, estimate logo, and admin image produced verified UI state"
  });
  console.log("[smoke] data-field control verification complete");
}

function genericFieldValue(formType, name, inputType) {
  const key = String(name || "").toLowerCase();
  if (inputType === "email" || key.includes("email")) return `ai.${formType}.${stamp}@example.com`;
  if (inputType === "tel" || key.includes("phone")) return "555-867-5309";
  if (inputType === "url" || key.includes("url")) {
    return key.includes("button") ? "#module/daily" : `${origin}/logo.png`;
  }
  if (inputType === "date" || key.includes("due") || key.includes("date")) return "2026-07-25";
  if (inputType === "datetime-local") return "2026-07-25T12:00";
  if (inputType === "time") return "12:00";
  if (inputType === "number" || inputType === "range") {
    if (key.includes("ttl")) return "48";
    if (key.includes("latitude")) return "42.45";
    if (key.includes("longitude")) return "-73.245";
    return "10";
  }
  if (inputType === "color") return "#1d4ed8";
  if (key.includes("accesscode") || key === "code") return `CODE${stamp}`;
  if (key.includes("job")) return ids.jobId;
  if (key.includes("customer")) return ids.customer;
  if (key.includes("amount") || key.includes("rate") || key.includes("cost") || key.includes("value")) return "125";
  if (key.includes("buttonurl")) return "#module/daily";
  if (key.includes("logourl") || key.includes("imageurl")) return `${origin}/logo.png`;
  if (key.includes("companyid")) return "default-company";
  if (key.includes("franchise")) return "default-franchise";
  if (key.includes("contractorid")) return `contractor-${stamp}`;
  if (key.includes("id")) return `${formType}-${stamp}`;
  return `AI ${formType} ${name || "field"} ${stamp}`;
}

async function fillFormGenerically(form, formType) {
  const controls = form.locator("input, textarea, select");
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible().catch(() => false)) continue;
    const metadata = await control.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      name: element.name || "",
      type: element.type || "",
      value: element.value || "",
      disabled: element.disabled,
      readOnly: element.readOnly
    }));
    if (metadata.disabled || metadata.readOnly) continue;
    if (["hidden", "file", "checkbox", "radio", "submit", "button"].includes(metadata.type)) continue;
    if (metadata.tagName === "select") {
      if (metadata.value) continue;
      const option = await control.locator("option:not([disabled])").evaluateAll((options) => {
        return options.find((item) => item.value)?.value || options[0]?.value || "";
      });
      if (option) await control.selectOption(option);
      continue;
    }
    if (metadata.value && metadata.type !== "range") continue;
    await control.fill(genericFieldValue(formType, metadata.name, metadata.type));
  }
  const valid = await form.evaluate((element) => element.checkValidity());
  if (!valid) {
    const invalid = await form.locator(":invalid").evaluateAll((elements) => elements.map((element) => element.name || element.outerHTML.slice(0, 80)));
    throw new Error(`${formType} remained invalid after automatic completion: ${invalid.join(", ")}`);
  }
}

async function submitGenericForm(page, formType) {
  const form = await firstVisible(page.locator(`form[data-form="${formType}"]`));
  if (!form) return false;
  await fillFormGenerically(form, formType);
  const submit = await firstVisible(form.locator('button[type="submit"], input[type="submit"]'));
  if (!submit) throw new Error(`${formType} did not expose a submit control`);
  await submit.click();
  actionCoverage.formsSubmitted.add(formType);
  await page.waitForTimeout(180);
  return true;
}

async function submitRemainingForms(page) {
  const modalForms = new Set(["create-file", "quick-note", "service-request", "user-manage"]);
  const separateContextForms = new Set(["access-request", "employee-profile", "ticket-signoff"]);
  for (const formType of [...actionCoverage.formsRendered]) {
    if (actionCoverage.formsSubmitted.has(formType) || modalForms.has(formType) || separateContextForms.has(formType)) continue;
    const location = actionCoverage.formLocations.get(formType);
    if (!location) continue;
    await go(page, location);
    const containingDisclosure = page.locator(`details:has(form[data-form="${formType}"])`).first();
    if (await containingDisclosure.count()) {
      await containingDisclosure.evaluate((element) => { element.open = true; });
    }
    if (!await submitGenericForm(page, formType)) {
      throw new Error(`${formType} was inventoried but could not be submitted at ${location}`);
    }
  }

  await go(page, "daily");
  await clickAny(page, 'button[data-action="open-create-file"]', "open create-file modal");
  await submitGenericForm(page, "create-file");

  await go(page, "daily");
  await clickAny(page, 'button[data-action="quick-note"]', "open quick-note modal");
  await submitGenericForm(page, "quick-note");

  await go(page, "daily");
  await clickAny(page, 'button[data-action="open-service-request"]', "open service-request modal");
  await submitGenericForm(page, "service-request");
  await go(page, "daily");
  await clickVisibleAction(page, "mark-callout-scheduled");

  await go(page, "accessadmin");
  const manageUser = await firstVisible(page.locator('button[data-action="open-user-manage"]'));
  if (!manageUser) throw new Error("Admin Access did not render a user management control");
  await manageUser.click();
  actionCoverage.exercised.add("open-user-manage");
  await submitGenericForm(page, "user-manage");

  await go(page, "accessadmin");
  await clickVisibleAction(page, "open-admin-edit");
  for (const formType of ["tab-config", "page-config", "page-section-config", "company-brand"]) {
    if (!await submitGenericForm(page, formType)) {
      throw new Error(`Admin edit mode did not render ${formType}`);
    }
  }
  await clickVisibleAction(page, "close-modal");

  await go(page, "insurance");
  const selectInsurance = await firstVisible(page.locator('button[data-action="select-insurance-submission"]'));
  if (selectInsurance) {
    await selectInsurance.click();
    actionCoverage.exercised.add("select-insurance-submission");
    await page.waitForTimeout(100);
  }
  await submitGenericForm(page, "insurance-status");
  await submitGenericForm(page, "insurance-notes");

  await go(page, "payments");
  await fill(page, 'form[data-form="payment-request"] input[name="customer"]', `AI Card Customer ${stamp}`);
  await fill(page, 'form[data-form="payment-request"] input[name="job"]', ids.jobId);
  await fill(page, 'form[data-form="payment-request"] input[name="amount"]', "25.00");
  await select(page, 'form[data-form="payment-request"] select[name="method"]', "Card");
  await fill(page, 'form[data-form="payment-request"] input[name="contact"]', `card.${stamp}@example.com`);
  await click(page, 'form[data-form="payment-request"] button[type="submit"]');
  await expectBody(page, "card checkout link created", "Open checkout");
  await clickVisibleAction(page, "copy-payment-link");
}

async function runWorkflow(page, localSmokeApi) {
  await go(page, "jobs");
  await fill(page, 'form[data-form="job-record"] input[name="jobId"]', ids.jobId);
  await fill(page, 'form[data-form="job-record"] input[name="title"]', ids.jobTitle);
  await fill(page, 'form[data-form="job-record"] input[name="customer"]', ids.customer);
  await fill(page, 'form[data-form="job-record"] input[name="property"]', `123 AI Test Ave ${stamp}`);
  await select(page, 'form[data-form="job-record"] select[name="stage"]', "Inspection");
  await fill(page, 'form[data-form="job-record"] input[name="owner"]', "AI QA");
  await fill(page, 'form[data-form="job-record"] textarea[name="nextAction"]', "Verify cross-module handoffs");
  await fill(page, 'form[data-form="job-record"] textarea[name="blockers"]', "None");
  await click(page, 'form[data-form="job-record"] button[type="submit"]');
  await expectBody(page, "job created", ids.jobId);

  await go(page, "sketch");
  const initialSketchRooms = await page.locator(".sketch-room-shape").count();
  const initialSketchWalls = await page.locator(".sketch-wall-shape").count();
  const initialSharedWalls = await page.locator(".sketch-wall-shape.shared").count();
  await click(page, '[data-action="select-sketch-wall"][data-id="WALL-1003"]');
  if (!await page.locator('form[data-form="sketch-connected-room"] button[type="submit"]').isDisabled()) {
    throw new Error("Sketch editor allows a third room on an occupied shared boundary");
  }
  await expectBody(page, "occupied sketch boundary blocked", "Boundary occupied");
  await click(page, '[data-action="select-sketch-wall"][data-id="WALL-1001"]');
  await fill(page, 'form[data-form="sketch-wall-edit"] input[name="length"]', "22.25");
  await click(page, 'form[data-form="sketch-wall-edit"] button[type="submit"]');
  await expectBody(page, "exact sketch wall length saved", "22.25 ft");
  await click(page, 'button[data-action="undo-sketch"]');
  const restoredWallLength = await page.locator('form[data-form="sketch-wall-edit"] input[name="length"]').inputValue();
  if (restoredWallLength !== "22") throw new Error(`Sketch undo restored ${restoredWallLength} ft instead of 22 ft`);

  await fill(page, 'form[data-form="sketch-connected-room"] input[name="name"]', ids.sketchRoom);
  await fill(page, 'form[data-form="sketch-connected-room"] input[name="depth"]', "8");
  await fill(page, 'form[data-form="sketch-connected-room"] input[name="assignedJob"]', ids.jobId);
  await fill(page, 'form[data-form="sketch-connected-room"] textarea[name="notes"]', "Automated connected-room verification");
  await click(page, 'form[data-form="sketch-connected-room"] button[type="submit"]');
  await expectBody(page, "connected sketch room created", ids.sketchRoom);
  const connectedSketchCounts = {
    rooms: await page.locator(".sketch-room-shape").count(),
    walls: await page.locator(".sketch-wall-shape").count(),
    sharedWalls: await page.locator(".sketch-wall-shape.shared").count()
  };
  if (connectedSketchCounts.rooms !== initialSketchRooms + 1
    || connectedSketchCounts.walls !== initialSketchWalls + 3
    || connectedSketchCounts.sharedWalls !== initialSharedWalls + 1) {
    throw new Error(`Connected sketch geometry mismatch: ${JSON.stringify(connectedSketchCounts)}`);
  }

  await page.locator('details:has(form[data-form="sketch-wall"])').evaluate((element) => { element.open = true; });
  const connectedRoomChip = page.locator(".sketch-room-chip").filter({ hasText: ids.sketchRoom });
  const connectedRoomAreaBeforeWall = (await connectedRoomChip.textContent())?.match(/([\d.]+)\s+sq ft/)?.[1];
  const assignedWallRoomId = await page.locator('form[data-form="sketch-wall"] select[name="roomId"]').inputValue();
  if (!assignedWallRoomId) throw new Error("Individual wall form did not retain the selected room association");
  await fill(page, 'form[data-form="sketch-wall"] input[name="x1"]', "40");
  await fill(page, 'form[data-form="sketch-wall"] input[name="y1"]', "40");
  await fill(page, 'form[data-form="sketch-wall"] input[name="x2"]', "48");
  await fill(page, 'form[data-form="sketch-wall"] input[name="y2"]', "40");
  await fill(page, 'form[data-form="sketch-wall"] textarea[name="notes"]', "Automated standalone-wall verification");
  await click(page, 'form[data-form="sketch-wall"] button[type="submit"]');
  if (await page.locator(".sketch-wall-shape").count() !== connectedSketchCounts.walls + 1) {
    throw new Error("Standalone sketch wall was not added");
  }
  const connectedRoomAreaAfterWall = (await page.locator(".sketch-room-chip").filter({ hasText: ids.sketchRoom }).textContent())?.match(/([\d.]+)\s+sq ft/)?.[1];
  if (connectedRoomAreaAfterWall !== connectedRoomAreaBeforeWall) {
    throw new Error("An assigned partition changed the room perimeter or measured area");
  }
  await click(page, 'button[data-action="undo-sketch"]');
  if (await page.locator(".sketch-wall-shape").count() !== connectedSketchCounts.walls) {
    throw new Error("Standalone sketch wall undo did not restore the plan");
  }

  await page.locator('details:has(form[data-form="sketch-room"])').evaluate((element) => { element.open = true; });
  await fill(page, 'form[data-form="sketch-room"] input[name="name"]', ids.sketchSeparateRoom);
  await fill(page, 'form[data-form="sketch-room"] input[name="assignedJob"]', ids.jobId);
  await fill(page, 'form[data-form="sketch-room"] input[name="width"]', "7");
  await fill(page, 'form[data-form="sketch-room"] input[name="height"]', "6");
  await fill(page, 'form[data-form="sketch-room"] textarea[name="notes"]', "Automated separate-room verification");
  await click(page, 'form[data-form="sketch-room"] button[type="submit"]');
  await expectBody(page, "separate sketch room created", ids.sketchSeparateRoom);
  if (await page.locator(".sketch-room-shape").count() !== connectedSketchCounts.rooms + 1
    || await page.locator(".sketch-wall-shape").count() !== connectedSketchCounts.walls + 4) {
    throw new Error("Separate sketch room geometry did not create four measured walls");
  }
  await click(page, 'button[data-action="save-sketch-file"]');
  await expectBody(page, "connected plan saved", `${ids.jobId} measured floor plan`);
  await go(page, "pricing");
  await expectBody(page, "connected plan linked to pricing", `${ids.jobId} measured floor plan`);
  await go(page, "jobs");
  await expectBody(page, "connected plan linked to jobs", `${ids.jobId} measured floor plan`);

  await go(page, "dispatch");
  await fill(page, 'form[data-form="module-workbench"] input[name="subject"]', ids.moduleRecord);
  await fill(page, 'form[data-form="module-workbench"] input[name="relatedJob"]', ids.jobId);
  await fill(page, 'form[data-form="module-workbench"] input[name="owner"]', "Dispatch supervisor");
  await select(page, 'form[data-form="module-workbench"] select[name="priority"]', "High");
  await fill(page, 'form[data-form="module-workbench"] input[name="due"]', "2026-07-23");
  await click(page, 'form[data-form="module-workbench"] button[type="submit"]');
  await expectBody(page, "typed dispatch record created", ids.moduleRecord);
  await go(page, "routeplanner");
  await expectBody(page, "typed dispatch record crossed into route planning", ids.moduleRecord);
  await click(page, `.module-record-card:has-text("${ids.moduleRecord}") button[data-action="complete-module-record"]`);
  await go(page, "dispatch");
  const completedDispatchRecord = page.locator(".module-record-card").filter({ hasText: ids.moduleRecord });
  await completedDispatchRecord.filter({ hasText: "Complete" }).waitFor({ state: "visible", timeout: 8000 });

  await go(page, "team");
  await fill(page, 'form[data-form="employee-invitation"] input[name="displayName"]', ids.employeeName);
  await fill(page, 'form[data-form="employee-invitation"] input[name="email"]', ids.employeeEmail);
  await fill(page, 'form[data-form="employee-invitation"] input[name="phone"]', "555-222-3030");
  await fill(page, 'form[data-form="employee-invitation"] input[name="jobTitle"]', "Field technician");
  await select(page, 'form[data-form="employee-invitation"] select[name="employmentType"]', "Employee");
  await fill(page, 'form[data-form="employee-invitation"] input[name="startDate"]', "2026-07-20");
  await fill(page, 'form[data-form="employee-invitation"] input[name="assignedJobIds"]', ids.jobId);
  const employeeApplicationGroup = page.locator('form[data-form="employee-invitation"] [data-application-access-group="general-contracting"]');
  const employeeApplicationToggle = employeeApplicationGroup.locator('[data-application-access="general-contracting"]');
  const employeeApplicationModules = employeeApplicationGroup.locator('input[name="visibleModuleKeys"]');
  await employeeApplicationModules.first().uncheck();
  const partialApplicationState = await employeeApplicationToggle.evaluate((input) => ({
    checked: input.checked,
    indeterminate: input.indeterminate,
    moduleStates: [...input.closest("[data-application-access-group]").querySelectorAll('input[name="visibleModuleKeys"]')]
      .map((moduleInput) => ({ value: moduleInput.value, checked: moduleInput.checked }))
  }));
  if (!partialApplicationState.checked || !partialApplicationState.indeterminate) {
    throw new Error(`A partial application grant did not display its mixed module-access state: ${JSON.stringify(partialApplicationState)}`);
  }
  await employeeApplicationToggle.uncheck();
  if ((await employeeApplicationModules.evaluateAll((inputs) => inputs.some((input) => input.checked)))) {
    throw new Error("Removing application access left an employee module selected");
  }
  await employeeApplicationToggle.check();
  if (!(await employeeApplicationModules.evaluateAll((inputs) => inputs.every((input) => input.checked)))) {
    throw new Error("Granting application access did not select every allowed employee module");
  }
  results.workflowChecks.push({ label: "Application access controls", text: "full, partial, and removed module grants stay synchronized" });
  const employeeInviteSubmit = page.locator('form[data-form="employee-invitation"] button[type="submit"]');
  if (await employeeInviteSubmit.isDisabled()) {
    throw new Error("Employee invitation submit is disabled even though secure storage is available");
  }
  const employeeInviteResponse = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/api/employee-invitations"
      && response.request().method() === "POST";
  });
  await click(page, 'form[data-form="employee-invitation"] button[type="submit"]');
  const inviteResponse = await employeeInviteResponse;
  const inviteResult = await inviteResponse.json().catch(() => ({}));
  if (!inviteResponse.ok() || inviteResult.success === false || inviteResult.grant?.email !== ids.employeeEmail) {
    throw new Error(`Employee invitation API failed: ${inviteResult.message || inviteResponse.status()}`);
  }
  await expectBody(page, "pending employee profile created", ids.employeeEmail);
  await expectBody(page, "pending employee is visible before acceptance", "Invitation pending");
  const pendingEmployeeCard = page.locator(".team-card").filter({ hasText: ids.employeeEmail });
  if (await pendingEmployeeCard.locator('[data-action="open-user-manage"], [data-action="reset-user-permissions"], [data-action="toggle-user-disabled"], [data-action="delete-user"]').count()) {
    throw new Error("Pending employee exposed accepted-user management controls");
  }
  await click(page, `.team-card:has-text("${ids.employeeEmail}") button[data-action="open-pending-employee-manage"]`);
  await fill(page, 'form[data-form="pending-employee-manage"] input[name="jobTitle"]', "Lead field technician");
  await click(page, 'form[data-form="pending-employee-manage"] button[type="submit"]');
  await expectBody(page, "pending employee profile updated", "Lead field technician");

  const moduleOptions = await page.locator('form[data-form="task"] select[name="moduleKey"] option').evaluateAll((options) => {
    return options.map((option) => option.value);
  });
  for (const requiredModule of ["photos", "payments", "communications"]) {
    if (!moduleOptions.includes(requiredModule)) {
      throw new Error(`Task module selector is missing ${requiredModule}`);
    }
  }

  const assigneeValue = await page.locator('form[data-form="task"] select[name="assigneeId"] option')
    .evaluateAll((options, email) => options.find((option) => option.textContent.includes(email))?.value || "", ids.employeeEmail);
  if (!assigneeValue) throw new Error("New employee did not appear in task assignee list");
  await select(page, 'form[data-form="task"] select[name="assigneeId"]', assigneeValue);
  await select(page, 'form[data-form="task"] select[name="moduleKey"]', "photos");
  await fill(page, 'form[data-form="task"] input[name="title"]', ids.taskTitle);
  await fill(page, 'form[data-form="task"] input[name="relatedJob"]', ids.jobId);
  await fill(page, 'form[data-form="task"] input[name="due"]', "2026-07-24");
  await select(page, 'form[data-form="task"] select[name="priority"]', "High");
  await click(page, 'form[data-form="task"] button[type="submit"]');
  await expectBody(page, "photo task assigned", ids.taskTitle);

  await go(page, "pricing");
  await click(page, 'button[data-action="import-sample-pricing"]');
  await fill(page, 'form[data-form="price-item"] input[name="code"]', ids.priceCode);
  await fill(page, 'form[data-form="price-item"] input[name="name"]', ids.priceName);
  await fill(page, 'form[data-form="price-item"] input[name="category"]', "Labor");
  await fill(page, 'form[data-form="price-item"] input[name="unit"]', "hour");
  await fill(page, 'form[data-form="price-item"] input[name="rate"]', "145");
  await fill(page, 'form[data-form="price-item"] input[name="cost"]', "62");
  await fill(page, 'form[data-form="price-item"] input[name="branch"]', "AI QA Branch");
  await fill(page, 'form[data-form="price-item"] textarea[name="justification"]', "AI QA price item for cross-module invoice testing");
  await click(page, 'form[data-form="price-item"] button[type="submit"]');
  await expectBody(page, "price item saved", ids.priceCode);
  await fill(page, 'form[data-form="estimate-line"] input[name="qty"]', "2");
  await fill(page, 'form[data-form="estimate-line"] input[name="note"]', `Linked to ${ids.jobId}`);
  await click(page, 'form[data-form="estimate-line"] button[type="submit"]');
  await click(page, '.estimate-preview button[data-action="create-estimate-invoice"]');
  await expectBody(page, "estimate invoice created", ids.jobId);

  await go(page, "payments");
  await fill(page, 'form[data-form="payment-request"] input[name="customer"]', ids.paymentCustomer);
  await fill(page, 'form[data-form="payment-request"] input[name="job"]', ids.jobId);
  await fill(page, 'form[data-form="payment-request"] input[name="amount"]', "1234.56");
  await select(page, 'form[data-form="payment-request"] select[name="method"]', "Wire");
  await fill(page, 'form[data-form="payment-request"] input[name="contact"]', ids.employeeEmail);
  await click(page, 'form[data-form="payment-request"] button[type="submit"]');
  await expectBody(page, "payment request saved", ids.paymentCustomer);

  await go(page, "drylogs");
  await select(page, 'form[data-form="dry-log"] select[name="jobId"]', ids.jobId);
  await fill(page, 'form[data-form="dry-log"] input[name="technician"]', ids.employeeName);
  await fill(page, 'form[data-form="dry-log"] input[name="room"]', ids.dryRoom);
  await fill(page, 'form[data-form="dry-log"] input[name="material"]', "Drywall");
  await fill(page, 'form[data-form="dry-log"] input[name="moisture"]', "18.5");
  await fill(page, 'form[data-form="dry-log"] input[name="targetMoisture"]', "12");
  await fill(page, 'form[data-form="dry-log"] input[name="relativeHumidity"]', "43");
  await fill(page, 'form[data-form="dry-log"] input[name="temperature"]', "71");
  await select(page, 'form[data-form="dry-log"] select[name="status"]', "Drying");
  await fill(page, 'form[data-form="dry-log"] input[name="photoRef"]', ids.photoRef);
  await fill(page, 'form[data-form="dry-log"] textarea[name="notes"]', "AI QA dry log should update job and payments support");
  await click(page, 'form[data-form="dry-log"] button[type="submit"]');
  await expectBody(page, "dry log saved", ids.dryRoom);

  await go(page, "photos");
  await select(page, 'form[data-form="photo-evidence"] select[name="jobId"]', ids.jobId);
  const photoTaskValue = await page.locator('form[data-form="photo-evidence"] select[name="taskId"] option')
    .evaluateAll((options, title) => options.find((option) => option.textContent.includes(title))?.value || "", ids.taskTitle);
  if (!photoTaskValue) throw new Error("Assigned photo task did not appear in the photo evidence form");
  await select(page, 'form[data-form="photo-evidence"] select[name="taskId"]', photoTaskValue);
  await fill(page, 'form[data-form="photo-evidence"] input[name="room"]', ids.dryRoom);
  await select(page, 'form[data-form="photo-evidence"] select[name="category"]', "Invoice support");
  await page.locator('form[data-form="photo-evidence"] input[name="photoFile"]').setInputFiles({
    name: ids.photoRef,
    mimeType: "image/png",
    buffer: smokePng
  });
  await fill(page, 'form[data-form="photo-evidence"] textarea[name="notes"]', "AI QA photo evidence should complete the assigned photo task");
  await click(page, 'form[data-form="photo-evidence"] button[type="submit"]');
  if (localSmokeApi) {
    await waitUntil("durable photo evidence", () => (localSmokeApi.getWorkspaceState().photoRecords || [])
      .some((record) => record.photoRef === ids.photoRef && record.jobId === ids.jobId));
  } else {
    await page.locator(".toast").filter({ hasText: "Photo evidence saved" }).waitFor({ state: "visible" });
  }
  await expectBody(page, "photo evidence saved", ids.photoRef);
  await select(page, 'form[data-form="job-note"] select[name="jobId"]', ids.jobId);
  await select(page, 'form[data-form="job-note"] select[name="noteType"]', "Customer update");
  const linkedJobNote = `Customer note for ${ids.jobId} should link to communications and closeout`;
  await fill(page, 'form[data-form="job-note"] textarea[name="notes"]', linkedJobNote);
  await click(page, 'form[data-form="job-note"] button[type="submit"]');
  if (localSmokeApi) {
    await waitUntil("durable linked job note", () => JSON.stringify(localSmokeApi.getWorkspaceState()).includes(linkedJobNote));
  } else {
    await page.locator(".toast").filter({ hasText: "Job note saved" }).waitFor({ state: "visible" });
  }
  await expectBody(page, "job note saved", `Customer note for ${ids.jobId}`);
  await go(page, "communications");
  await expectBody(page, "job note linked to communications", linkedJobNote);
  await go(page, "photos");

  await go(page, "equipment");
  await fill(page, 'form[data-form="equipment-deployment"] input[name="equipmentName"]', ids.equipmentName);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="assetTag"]', ids.assetTag);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="job"]', ids.jobId);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="room"]', ids.dryRoom);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="invoiceNumber"]', `INV-${stamp}`);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="address"]', `123 AI Test Ave ${stamp}`);
  await fill(page, 'form[data-form="equipment-deployment"] input[name="latitude"]', "42.45010");
  await fill(page, 'form[data-form="equipment-deployment"] input[name="longitude"]', "-73.24540");
  await fill(page, 'form[data-form="equipment-deployment"] input[name="rentalDays"]', "3");
  await fill(page, 'form[data-form="equipment-deployment"] input[name="dailyRate"]', "95");
  await fill(page, 'form[data-form="equipment-deployment"] textarea[name="notes"]', "AI QA billable equipment record");
  await click(page, 'form[data-form="equipment-deployment"] button[type="submit"]');
  await expectBody(page, "equipment saved", ids.assetTag);
  const equipmentInvoiceButtonId = await page.evaluate((assetTag) => {
    const card = [...document.querySelectorAll(".equipment-card")].find((node) => node.textContent.includes(assetTag));
    return card?.querySelector('button[data-action="create-equipment-invoice"]')?.dataset.id || "";
  }, ids.assetTag);
  if (!equipmentInvoiceButtonId) throw new Error("Equipment invoice button did not render for the new deployment");
  await click(page, `button[data-action="create-equipment-invoice"][data-id="${equipmentInvoiceButtonId}"]`);
  await expectBody(page, "equipment invoice created", ids.equipmentName);

  await go(page, "time");
  await fill(page, 'form[data-form="clock-in"] input[name="worker"]', ids.employeeName);
  const linkedClockTaskId = await page.locator('form[data-form="clock-in"] select[name="task"] option')
    .evaluateAll((options, title) => options.find((option) => option.textContent.includes(title))?.value || "", ids.taskTitle);
  if (!linkedClockTaskId) throw new Error("Assigned task did not appear in the GPS clock task selector");
  await exerciseDataField(page, "clock-job", (field) => field.fill(`WRONG-JOB-${stamp}`), "GPS clock job");
  await exerciseDataField(page, "clock-task", (field) => field.selectOption(linkedClockTaskId), "GPS clock task");
  await waitUntil("clock task-to-job linkage", async () => {
    return await page.locator('[data-field="clock-job"]').inputValue() === ids.jobId;
  });

  await page.waitForTimeout(700);
  const deniedClockInWriteCount = localSmokeApi?.getWorkspaceWriteCount();
  const deniedClockInActiveCount = localSmokeApi?.getWorkspaceState()?.activeClockSessions?.length || 0;
  await setGpsDenied(page, true);
  await page.context().clearPermissions();
  await click(page, 'form[data-form="clock-in"] button[type="submit"]');
  await page.locator(".toast").filter({ hasText: "GPS permission and a valid position are required to clock in" }).waitFor({ state: "visible" });
  await page.waitForTimeout(700);
  if (!await page.locator('form[data-form="clock-in"]').count() || await page.locator(".clock-card").count()) {
    throw new Error("Denied GPS created an active clock-in session");
  }
  if (localSmokeApi && (localSmokeApi.getWorkspaceState()?.activeClockSessions?.length || 0) !== deniedClockInActiveCount) {
    throw new Error("Denied GPS changed durable active clock sessions");
  }
  if (localSmokeApi && localSmokeApi.getWorkspaceWriteCount() !== deniedClockInWriteCount) {
    throw new Error("Denied GPS reached the durable workspace API during clock-in");
  }

  await setGpsDenied(page, false);
  await page.context().grantPermissions(["geolocation"], { origin });
  await fill(page, 'form[data-form="clock-in"] input[name="worker"]', ids.employeeName);
  await exerciseDataField(page, "clock-job", (field) => field.fill(`WRONG-JOB-RETRY-${stamp}`), "GPS clock job retry");
  await exerciseDataField(page, "clock-task", (field) => field.selectOption(linkedClockTaskId), "GPS clock task retry");
  await waitUntil("clock task-to-job linkage after GPS retry", async () => {
    return await page.locator('[data-field="clock-job"]').inputValue() === ids.jobId;
  });
  await click(page, 'form[data-form="clock-in"] button[type="submit"]');
  await expectBody(page, "clocked in", "Clocked in");
  const activeClockCard = page.locator(".clock-card").filter({ hasText: ids.employeeName });
  await activeClockCard.filter({ hasText: ids.jobId }).filter({ hasText: ids.taskTitle }).waitFor({ state: "visible" });
  if (localSmokeApi) {
    await waitUntil("durable linked active shift", () => {
      return Boolean(localSmokeApi.getWorkspaceState()?.activeClockSessions?.some((session) => {
        return session.taskId === linkedClockTaskId && session.job === ids.jobId && session.task === ids.taskTitle;
      }));
    });
  }

  await setGpsDenied(page, true);
  await page.context().clearPermissions();
  const deniedClockOutWriteCount = localSmokeApi?.getWorkspaceWriteCount();
  const deniedClockOutTimeCount = localSmokeApi?.getWorkspaceState()?.timeEntries?.length || 0;
  await click(page, 'button[data-action="clock-out"]');
  await page.locator(".toast").filter({ hasText: "GPS permission and a valid position are required to clock out" }).waitFor({ state: "visible" });
  await page.waitForTimeout(700);
  if (!await page.locator(".clock-card").filter({ hasText: ids.taskTitle }).count()) {
    throw new Error("Denied GPS closed the active shift");
  }
  if (localSmokeApi && (localSmokeApi.getWorkspaceState()?.timeEntries?.length || 0) !== deniedClockOutTimeCount) {
    throw new Error("Denied GPS created a durable time entry during clock-out");
  }
  if (localSmokeApi && localSmokeApi.getWorkspaceWriteCount() !== deniedClockOutWriteCount) {
    throw new Error("Denied GPS reached the durable workspace API during clock-out");
  }

  await setGpsDenied(page, false);
  await page.context().grantPermissions(["geolocation"], { origin });
  await click(page, 'button[data-action="clock-out"]');
  await expectBody(page, "clocked out", ids.employeeName);
  const linkedTimeRow = page.locator(".data-table tbody tr").filter({ hasText: ids.employeeName }).filter({ hasText: ids.jobId }).filter({ hasText: ids.taskTitle });
  await linkedTimeRow.waitFor({ state: "visible" });
  if (localSmokeApi) {
    await waitUntil("durable linked time entry", () => {
      return Boolean(localSmokeApi.getWorkspaceState()?.timeEntries?.some((entry) => {
        return entry.taskId === linkedClockTaskId && entry.job === ids.jobId && entry.task === ids.taskTitle && Number.isFinite(entry.endGps?.latitude);
      }));
    });
  }
  results.workflowChecks.push({
    label: "GPS time clock",
    text: "task selection linked the job; denied GPS made no write; approved GPS persisted the active shift and time entry"
  });

  await go(page, "payments");
  await expectBody(page, "payments show linked job", ids.jobId);
  await expectBody(page, "payments show request customer", ids.paymentCustomer);
  await expectBody(page, "payments show equipment invoice", ids.equipmentName);

  await go(page, "team");
  await expectBody(page, "team shows employee", ids.employeeEmail);
  await expectBody(page, "team shows secure portal method", "verified Google account");
  await expectBody(page, "team shows assigned task", ids.taskTitle);
  await expectBody(page, "photo evidence retained the pending employee task assignment", `1 assigned task | Jobs: ${ids.jobId}`);
  await page.locator(".task-item").filter({ hasText: ids.taskTitle }).filter({ hasText: "Mark complete" }).waitFor({ state: "visible", timeout: 8000 });
  await go(page, "photos");
  const openAssignmentFile = page.locator(".file-card").filter({ hasText: ids.taskTitle }).filter({ hasText: "Task assignment" });
  await openAssignmentFile.filter({ hasText: "Open" }).waitFor({ state: "visible", timeout: 8000 });

  await go(page, "communications");
  await fill(page, 'form[data-form="community-post"] input[name="title"]', `AI contractor question ${stamp}`);
  await fill(page, 'form[data-form="community-post"] textarea[name="body"]', `Can the field team confirm documentation for ${ids.jobId}?`);
  await fill(page, 'form[data-form="community-post"] input[name="tags"]', "qa, field");
  await click(page, 'form[data-form="community-post"] button[type="submit"]');
  await expectBody(page, "community post published", `AI contractor question ${stamp}`);
  const postId = await page.locator('form[data-form="community-comment"] input[name="postId"]').first().inputValue();
  await fill(page, `form[data-form="community-comment"]:has(input[value="${postId}"]) input[name="body"]`, `Documentation confirmed for ${ids.jobId}`);
  await click(page, `form[data-form="community-comment"]:has(input[value="${postId}"]) button[type="submit"]`);
  await expectBody(page, "community comment published", `Documentation confirmed for ${ids.jobId}`);
}

async function verifyGenericModuleConnectivity(page, moduleKeys) {
  console.log("[smoke] starting semantic generic-module verification");
  for (const key of moduleKeys) {
    if (key === "dispatch") continue;
    await go(page, key);
    const form = page.locator('form[data-form="module-workbench"]');
    if (!await form.count()) continue;
    const title = `Connected ${key} record ${stamp}`;
    await fill(page, 'form[data-form="module-workbench"] input[name="subject"]', title);
    await fill(page, 'form[data-form="module-workbench"] input[name="relatedJob"]', ids.jobId);
    await fill(page, 'form[data-form="module-workbench"] input[name="owner"]', "AI semantic verifier");
    await click(page, 'form[data-form="module-workbench"] button[type="submit"]');
    const sourceCard = page.locator(".module-record-card").filter({ hasText: title }).first();
    await sourceCard.waitFor({ state: "visible", timeout: 8000 });
    const downstreamKey = await sourceCard.locator('.workflow-links a[data-key]').first().getAttribute("data-key");
    if (!downstreamKey) throw new Error(`${key} created a record without a downstream module link`);
    await go(page, downstreamKey);
    await expectBody(page, `${key} record reached ${downstreamKey}`, title);
    semanticModuleRecords.push({ key, downstreamKey, title });
  }
  results.semanticModuleRecords = semanticModuleRecords.length;
}

async function verifyDurableReload(page, localSmokeApi) {
  if (!localSmokeApi) return;
  const requiredValues = [
    ids.jobId,
    ids.employeeEmail,
    ids.taskTitle,
    ids.moduleRecord,
    ids.sketchRoom,
    ids.sketchSeparateRoom,
    ids.priceCode,
    ids.paymentCustomer,
    ids.photoRef,
    ids.assetTag
  ];
  await waitUntil("durable workspace write", () => {
    const serialized = JSON.stringify(localSmokeApi.getWorkspaceState());
    return requiredValues.every((value) => serialized.includes(value));
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".app-shell", { timeout: 15000 });
  await go(page, "jobs");
  await expectBody(page, "reload retained job", ids.jobId);
  await go(page, "dispatch");
  await expectBody(page, "reload retained typed cross-module record", ids.moduleRecord);
  await go(page, "routeplanner");
  await expectBody(page, "reload retained linked route-planning record", ids.moduleRecord);
  await go(page, "team");
  await expectBody(page, "reload retained employee", ids.employeeEmail);
  await expectBody(page, "reload retained task", ids.taskTitle);
  await go(page, "sketch");
  await expectBody(page, "reload retained connected room", ids.sketchRoom);
  await expectBody(page, "reload retained separate room", ids.sketchSeparateRoom);
  await expectBody(page, "reload retained connected plan", `${ids.jobId} measured floor plan`);
  await go(page, "pricing");
  await expectBody(page, "reload retained price item", ids.priceCode);
  await go(page, "payments");
  await expectBody(page, "reload retained invoice and payment linkage", ids.jobId);
  await expectBody(page, "reload retained payment request", ids.paymentCustomer);
  await go(page, "photos");
  await expectBody(page, "reload retained photo evidence", ids.photoRef);
  await go(page, "communications");
  await expectBody(page, "reload retained community post", `AI contractor question ${stamp}`);
  await expectBody(page, "reload retained community comment", `Documentation confirmed for ${ids.jobId}`);
  for (const record of semanticModuleRecords) {
    await go(page, record.key);
    await expectBody(page, `reload retained ${record.key} semantic record`, record.title);
  }
  results.durableReloadVerified = true;
}

async function verifyLegacyBrowserRoundTrip(page, localSmokeApi) {
  if (!localSmokeApi) return;
  const legacyRecords = localSmokeApi.injectLegacyRecords();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".app-shell", { timeout: 15000 });
  await go(page, "dispatch");
  const validTitle = `Registered record after legacy hydration ${stamp}`;
  await fill(page, 'form[data-form="module-workbench"] input[name="subject"]', validTitle);
  await fill(page, 'form[data-form="module-workbench"] input[name="relatedJob"]', ids.jobId);
  await fill(page, 'form[data-form="module-workbench"] input[name="owner"]', "AI legacy verifier");
  await select(page, 'form[data-form="module-workbench"] select[name="priority"]', "High");
  await click(page, 'form[data-form="module-workbench"] button[type="submit"]');
  await waitUntil("legacy browser round-trip write", () => JSON.stringify(localSmokeApi.getWorkspaceState()).includes(validTitle));
  const savedState = localSmokeApi.getWorkspaceState();
  const roundTripCases = [
    ["module record", savedState.moduleRecords, legacyRecords.moduleRecord],
    ["file", savedState.files, legacyRecords.file],
    ["task-assignment file", savedState.files, legacyRecords.taskAssignmentFile],
    ["task", savedState.tasks, legacyRecords.task]
  ];
  for (const [label, records, expected] of roundTripCases) {
    const savedRecord = records?.find((record) => record.id === expected.id);
    if (JSON.stringify(savedRecord) !== JSON.stringify(expected)) {
      throw new Error(`Browser hydration modified an opaque legacy ${label}`);
    }
  }
  results.legacyBrowserRoundTripVerified = true;
  results.workflowChecks.push({ label: "Legacy record round-trip", text: "opaque module, file, and task data remained byte-for-byte unchanged beside a registered write" });
}

async function refreshCoverage(page, moduleKeys) {
  for (const key of moduleKeys) {
    await go(page, key);
    await collectPageCoverage(page, key);
  }
}

async function clickVisibleAction(page, action, label = action) {
  const target = await firstVisible(page.locator(`button[data-action="${action}"], a[data-action="${action}"]`));
  if (!target) return false;
  await target.click();
  actionCoverage.exercised.add(action);
  await page.waitForTimeout(140);
  return true;
}

async function ensureNoModal(page) {
  const modal = await firstVisible(page.locator(".modal-backdrop"));
  if (!modal) return;
  await page.keyboard.press("Escape");
  await page.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 3000 });
}

async function ensureCopilotClosed(page) {
  const copilot = await firstVisible(page.locator(".ai-copilot.open"));
  if (!copilot) return;
  const hideButton = await firstVisible(copilot.locator('button[data-action="toggle-ai-copilot"]'));
  if (!hideButton) throw new Error("Open AI Copilot did not expose a close control");
  await hideButton.click();
  actionCoverage.exercised.add("toggle-ai-copilot");
  await page.locator(".ai-copilot.open").waitFor({ state: "detached", timeout: 3000 });
}

async function exerciseModalAndUtilityActions(page) {
  await go(page, "daily");
  await clickVisibleAction(page, "open-create-file");
  const dialog = page.locator('.modal-backdrop [role="dialog"]');
  await dialog.waitFor({ state: "visible" });
  const labelledBy = await dialog.getAttribute("aria-labelledby");
  if (!labelledBy || await page.locator(`#${labelledBy}`).count() !== 1) {
    throw new Error("Create-file dialog is missing a valid accessible label");
  }
  const focusedInside = await page.evaluate(() => Boolean(document.querySelector('.modal-backdrop [role="dialog"]')?.contains(document.activeElement)));
  const backgroundInert = await page.evaluate(() => {
    const backdrop = document.querySelector(".modal-backdrop");
    return [...document.querySelector("#app")?.children || []].filter((element) => element !== backdrop).every((element) => element.inert);
  });
  if (!focusedInside || !backgroundInert) throw new Error("Modal focus or inert-background behavior failed");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  results.workflowChecks.push({ label: "accessible modal", text: "label, initial focus, inert background, Escape close" });

  await clickVisibleAction(page, "open-create-file");
  await clickVisibleAction(page, "close-modal");

  await go(page, "daily");
  await clickVisibleAction(page, "open-activity");
  await clickVisibleAction(page, "clear-activity");
  await clickVisibleAction(page, "close-activity");

  await go(page, "daily");
  await clickVisibleAction(page, "open-export");
  await clickVisibleAction(page, "download-export");
  await clickVisibleAction(page, "close-export");
  await ensureNoModal(page);

  await go(page, "daily");
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await clickVisibleAction(page, "mobile-open");
  await clickVisibleAction(page, "mobile-close");
  await page.setViewportSize(originalViewport || { width: 1440, height: 900 });
}

async function exerciseAiActions(page) {
  await go(page, "daily");
  if (!await firstVisible(page.locator('[data-action="ai-copilot-ask"]'))) {
    await clickVisibleAction(page, "toggle-ai-copilot");
  }
  const query = `Summarize ${ids.jobId}`;
  await exerciseDataField(page, "ai-copilot-query", (field) => field.fill(query), "Brother Copilot query");
  await clickVisibleAction(page, "ai-copilot-ask");
  await page.locator(".copilot-messages .user").filter({ hasText: query }).waitFor({ state: "visible" });
  await clickVisibleAction(page, "toggle-ai-copilot");
}

async function exerciseRemainingActions(page) {
  const deferred = new Set([
    "ai-copilot-ask",
    "clear-activity",
    "close-activity",
    "close-export",
    "close-modal",
    "delete-file",
    "delete-user",
    "download-export",
    "firebase-google-login",
    "firebase-logout",
    "mobile-close",
    "mobile-open",
    "open-activity",
    "open-export"
  ]);
  const destructive = ["delete-file", "delete-user", "revoke-employee-invitation"];

  await exerciseModalAndUtilityActions(page);
  await exerciseAiActions(page);

  for (const action of staticActionTypes) {
    if (actionCoverage.exercised.has(action) || deferred.has(action) || destructive.includes(action)) continue;
    const location = actionCoverage.actionLocations.get(action);
    if (!location) continue;
    await ensureNoModal(page);
    await ensureCopilotClosed(page);
    await go(page, location);
    if (action === "toggle-admin-edit" || action === "open-admin-edit") {
      if (await clickVisibleAction(page, action)) await clickVisibleAction(page, "close-modal");
      continue;
    }
    if (action === "open-user-manage" || action === "open-pending-employee-manage") {
      if (await clickVisibleAction(page, action)) await clickVisibleAction(page, "close-modal");
      continue;
    }
    if (action === "open-service-request" || action === "quick-note" || action === "open-employee-login") {
      if (await clickVisibleAction(page, action)) await clickVisibleAction(page, "close-modal");
      continue;
    }
    await clickVisibleAction(page, action);
  }

  for (const action of destructive) {
    if (actionCoverage.exercised.has(action)) continue;
    const location = actionCoverage.actionLocations.get(action);
    if (!location) continue;
    await ensureNoModal(page);
    await ensureCopilotClosed(page);
    await go(page, location);
    if (action === "revoke-employee-invitation") {
      page.once("dialog", (dialog) => dialog.accept());
    }
    await clickVisibleAction(page, action);
  }

  await go(page, "daily");
  const logoutRequest = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/api/auth/session/logout"
      && response.request().method() === "POST";
  });
  await clickVisibleAction(page, "firebase-logout");
  const logoutResponse = await logoutRequest;
  if (!logoutResponse.ok()) throw new Error("Firebase logout endpoint did not accept the sign-out request");
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".auth-gate", { timeout: 8000 });
}

async function testEmployeeGoogleSwitch(page, localSmokeApi) {
  await go(page, "team");
  await clickAny(page, 'button[data-action="open-employee-login"]', "open employee Google sign-in");
  await expectBody(page, "employee access requires Google", "Google-secured field portal");
  await page.evaluate(() => {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  });
  const logoutResponsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/api/auth/session/logout"
      && response.request().method() === "POST";
  }, { timeout: 20000 });
  await clickAny(page, 'button[data-action="employee-google-switch"]', "continue to employee Google sign-in");
  const logoutResponse = await logoutResponsePromise;
  if (!logoutResponse.ok()) throw new Error("Employee Google switch did not complete the secure server logout");
  await page.waitForSelector('button[data-action="firebase-google-login"]', { timeout: 20000 });
  if (await page.locator('form[data-form="employee-login"]').count()) {
    throw new Error("A local employee credential form is still exposed after sign-out");
  }
  results.workflowChecks.push({ label: "Employee Google switch", text: "signed out owner session and returned to the Google-only gate" });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".auth-gate", { timeout: 15000 });
  if (localSmokeApi) {
    localSmokeApi.setSessionActive(true);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(".app-shell", { timeout: 15000 });
  }
}

async function testUnauthenticatedGate(browser) {
  console.log("[smoke] starting unauthenticated gate verification");
  let requestSubmitted = false;
  const gateContext = await browser.newContext({
    viewport: { width: 390, height: 844 }
  });
  const page = await gateContext.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (status, body) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
    if (url.pathname === "/api/auth/config") {
      return json(200, {
        success: true,
        firebase: {
          enabled: true,
          ready: true,
          adminConfigured: true,
          webConfigured: true,
          allowedSignInProviders: ["google.com"],
          ownerOnlyLogin: true,
          allowedLoginEmails: ["david@brothersrestoration.org"],
          sessionTtlHours: 48,
          inviteEmailConfigured: true,
          missingAdminEnv: [],
          missingWebEnv: [],
          apiKey: "smoke-api-key",
          authDomain: "brothers-restoration-website.firebaseapp.com",
          projectId: "brothers-restoration-website",
          storageBucket: "brothers-restoration-website.firebasestorage.app",
          appId: "smoke-app-id",
          messagingSenderId: "80592032671"
        }
      });
    }
    if (url.pathname === "/api/auth/session") return json(401, { success: false, message: "Authentication required." });
    if (url.pathname === "/api/access/trial-request" && request.method() === "POST") {
      requestSubmitted = true;
      return json(201, { success: true, message: "Your 48-hour access request was sent for owner approval." });
    }
    return json(404, { success: false, message: "Smoke route not configured." });
  });
  await page.goto(`${baseUrl}/?gate=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  console.log("[smoke] unauthenticated gate loaded");
  const googleButton = page.locator('[data-action="firebase-google-login"]');
  await googleButton.waitFor({ state: "visible", timeout: 20000 });
  const buttonText = (await googleButton.textContent() || "").trim();
  if (!/google/i.test(buttonText) || await googleButton.isDisabled()) {
    throw new Error("Google authentication control is missing or disabled on the login gate");
  }
  actionCoverage.rendered.add("firebase-google-login");
  const accessCode = `GATE-${stamp}`;
  await exerciseDataField(page, "login-access-code", (field) => field.fill(accessCode), "Google login access code");
  if (await page.locator('[data-field="login-access-code"]').inputValue() !== accessCode) {
    throw new Error("Login access code field did not retain the invitation code");
  }
  actionCoverage.formsRendered.add("access-request");
  const disclosure = page.locator('details.auth-disclosure:has(form[data-form="access-request"])');
  if (await disclosure.count()) await disclosure.evaluate((element) => { element.open = true; });
  await submitGenericForm(page, "access-request");
  await expectBody(page, "trial request submitted", "48-hour access request");
  if (!requestSubmitted) throw new Error("Trial request did not reach the protected access API");
  results.workflowChecks.push({ label: "Google login gate", text: "visible account chooser button and 48-hour request path" });
  console.log("[smoke] unauthenticated gate verified");
  await gateContext.close();
}

async function testResponsiveInputs(page, localSmokeApi) {
  if (!localSmokeApi) return;
  await go(page, "dispatch");
  await click(page, '[data-action="quick-note"][data-key="dispatch"]');
  await fill(page, 'form[data-form="quick-note"] input[name="title"]', `Input preservation ${stamp}`);
  await fill(page, 'form[data-form="quick-note"] textarea[name="notes"]', "Regression test for toast expiry and navigation input.");
  await click(page, 'form[data-form="quick-note"] button[type="submit"]');
  const subject = page.locator('form[data-form="module-workbench"] input[name="subject"]');
  await subject.fill("Unsaved dispatch draft");
  const draftNode = await subject.elementHandle();
  await waitUntil("prior write settled", async () => {
    const stored = localSmokeApi.getWorkspaceState?.();
    return !stored || JSON.stringify(stored).includes(`Input preservation ${stamp}`);
  });
  await page.waitForTimeout(500);
  const writeCount = localSmokeApi.getWorkspaceWriteCount();
  const search = page.locator('.sidebar [data-field="search"]');
  await search.click();
  const inputNode = await search.elementHandle();
  await search.pressSequentially("dispatch", { delay: 25 });
  if (await search.inputValue() !== "dispatch") throw new Error("Typing lost characters in module search");
  if (!await inputNode.evaluate((node) => node.isConnected && node === document.activeElement)) {
    throw new Error("Module search replaced the focused input");
  }
  if (!await draftNode.evaluate((node) => node.isConnected && node.value === "Unsaved dispatch draft")) {
    throw new Error("Module search discarded another form draft");
  }
  await search.fill("");
  await page.locator('.sidebar [data-field="category"]').selectOption("dispatch");
  await page.locator('.sidebar [data-field="category"]').selectOption("all");
  await page.waitForTimeout(2800);
  if (!await draftNode.evaluate((node) => node.isConnected && node.value === "Unsaved dispatch draft")) {
    throw new Error("Toast expiry or category filtering replaced an unsaved form");
  }
  if (localSmokeApi.getWorkspaceWriteCount() !== writeCount) throw new Error("View filtering triggered a shared workspace write");
  await subject.fill("");
  results.workflowChecks.push({ label: "Responsive inputs", text: "continuous typing keeps focus; filtering and toast expiry preserve form drafts; view changes cause no shared writes" });
}

async function testEmergencyMonitor(page, localSmokeApi) {
  if (!localSmokeApi) return;
  console.log("[smoke] starting emergency incident workflow");
  await go(page, "dispatch");
  const monitor = page.locator("[data-emergency-monitor]");
  await monitor.getByText("No radio or dispatch feed connected.", { exact: false }).waitFor();
  await monitor.locator("summary").click();
  const manual = monitor.locator("[data-emergency-manual]");
  const reference = `FD-${stamp}`;
  await manual.locator('[name="eventId"]').fill(reference);
  await manual.locator('[name="location"]').fill("100 Test Avenue");
  await manual.locator('[name="occurredAt"]').fill("2026-09-19T10:30");
  await manual.locator('[name="units"]').fill("Engine 1, Ladder 2");
  await manual.locator('[name="summary"]').fill("Authorized dispatch report; review before assigning a crew.");
  await manual.getByRole("button", { name: "Save incident", exact: true }).click();
  const detail = monitor.locator("[data-emergency-detail]");
  await detail.getByText(reference, { exact: false }).waitFor();
  const create = detail.getByRole("button", { name: "Create dispatch record", exact: true });
  if (!await create.isDisabled()) throw new Error("Unreviewed incident allowed dispatch creation");
  await detail.getByRole("button", { name: "Dismiss", exact: true }).click();
  await detail.locator(".emergency-badge").filter({ hasText: "dismissed" }).waitFor();
  await detail.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await detail.locator(".emergency-badge").filter({ hasText: "reviewed" }).waitFor();
  await monitor.locator('[data-emergency-action="select"]').click();
  await monitor.getByRole("button", { name: "Refresh feed", exact: true }).click();
  await waitUntil("emergency refresh completed", async () => !await monitor.getByRole("button", { name: "Refresh feed", exact: true }).isDisabled());
  await create.click();
  await detail.getByText("Saved to dispatch workspace", { exact: true }).waitFor();
  const incident = localSmokeApi.getEmergencyIncidents().find((item) => item.eventId === reference);
  const workspace = localSmokeApi.getWorkspaceState();
  const record = workspace.moduleRecords?.find((item) => item.id === incident?.linkedRecordId);
  const file = workspace.files?.find((item) => item.sourceId === record?.id);
  if (!record || record.sourceIncidentId !== incident.id || record.moduleKey !== "dispatch" || !file?.linkedModuleKeys?.includes("routeplanner")) {
    throw new Error("Incident did not carry through durable dispatch records and route-planning file links");
  }
  await detail.getByRole("link", { name: "Open route planning", exact: true }).click();
  await expectBody(page, "Emergency incident in route planning", record.subject);
  await go(page, "dispatch");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-emergency-action="select"]').filter({ hasText: "100 Test Avenue" }).click();
  await page.getByText("Saved to dispatch workspace", { exact: true }).waitFor();
  const logo = page.locator('.sidebar img').first();
  if (!await logo.evaluate((image) => image.complete && image.naturalWidth > 0)) throw new Error("Brand shield failed to load");
  localSmokeApi.enableTestRadio();
  await monitor.getByRole("button", { name: "Refresh feed", exact: true }).click();
  const audio = monitor.locator("audio");
  await audio.waitFor();
  await audio.evaluate(async (element) => { element.loop = true; await element.play(); });
  await waitUntil("test radio playback", () => audio.evaluate((element) => !element.paused && element.readyState >= 2));
  await audio.evaluate((element) => element.pause());
  await monitor.locator("summary").click();
  await manual.locator('[name="eventId"]').fill("Unsaved incident draft");
  const draft = await manual.locator('[name="eventId"]').elementHandle();
  await monitor.getByRole("button", { name: "Refresh feed", exact: true }).click();
  await waitUntil("radio inbox refresh", async () => !await monitor.getByRole("button", { name: "Refresh feed", exact: true }).isDisabled());
  if (!await draft.evaluate((element) => element.isConnected && element.value === "Unsaved incident draft")) throw new Error("Incident refresh discarded a manual draft");
  await monitor.locator("summary").click();
  await monitor.scrollIntoViewIfNeeded();
  fs.mkdirSync(new URL("../logs/", import.meta.url), { recursive: true });
  await page.screenshot({ path: "logs/emergency-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await monitor.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error("Emergency monitor overflows mobile viewport");
  await page.screenshot({ path: "logs/emergency-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  results.workflowChecks.push({ label: "Emergency monitor", text: "manual entry, review, dismiss, refresh, dispatch handoff, route planning, reload, fixture audio playback/pause, draft preservation, desktop and mobile layout" });
}

async function testUnavailableStorageWriteLock(browser) {
  console.log("[smoke] starting shared-storage write-lock verification");
  const lockedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const lockedApi = await installLocalSmokeApi(lockedContext, { adminConfigured: false });
  const lockedPage = await lockedContext.newPage();
  lockedPage.setDefaultTimeout(8000);
  await go(lockedPage, "jobs");
  await expectBody(lockedPage, "shared storage warning visible", "Shared record editing is locked");
  await clickAny(lockedPage, 'button[data-action="open-create-file"]', "open file form while storage is locked");
  const blockedTitle = `Blocked browser-only file ${stamp}`;
  await fill(lockedPage, 'form[data-form="create-file"] input[name="title"]', blockedTitle);
  await clickAny(lockedPage, 'form[data-form="create-file"] button[type="submit"]', "attempt blocked file write");
  await expectBody(lockedPage, "browser-only write was rejected", "Secure shared storage is unavailable; no changes were made");
  await clickAny(lockedPage, 'button[data-action="close-modal"]', "close blocked write form");
  if ((await lockedPage.locator(".file-card").filter({ hasText: blockedTitle }).count()) || lockedApi.getWorkspaceWriteCount() !== 0) {
    throw new Error("A write reached browser or remote workspace state while Firebase Admin was unavailable");
  }
  results.workflowChecks.push({ label: "Durable write lock", text: "browser-only operational writes are rejected when Firebase Admin is unavailable" });
  await lockedContext.close();
}

async function testEmployeePortal(browser) {
  console.log("[smoke] starting employee portal verification");
  const worker = {
    id: "smoke-worker",
    uid: "smoke-worker",
    email: "employee.smoke@example.com",
    displayName: "Employee Smoke",
    roleId: "worker",
    companyId: "default-company",
    franchiseIds: ["default-franchise"],
    contractorId: "contractor-smoke",
    employerUid: "contractor-owner-smoke",
    employerEmail: "contractor.smoke@example.com",
    employerContractorId: "contractor-smoke",
    jobTitle: "Field technician",
    assignedJobIds: ["J-EMP-1"],
    assignedTaskIds: ["TASK-EMP-1"],
    visibleTabIds: ["time", "jobs", "photos", "equipment", "communications"],
    visiblePageIds: ["time", "jobs", "photos", "equipment", "communications"],
    status: "active",
    disabled: false
  };
  const workerModuleKeys = ["time", "jobs", "photos", "equipment", "communications"];
  const workerPermissions = {
    tabs: { mode: "allow", allowed: workerModuleKeys, hidden: [] },
    pages: { mode: "allow", allowed: workerModuleKeys, hidden: [] },
    sections: { mode: "all", allowed: [], hidden: [] },
    actions: {
      uploadImages: true,
      editAssignedTasks: true,
      postCommunityMessages: true,
      inviteWorkers: false,
      manageUsers: false,
      viewGlobalIndexes: false,
      viewRevenueData: false
    },
    dataAccess: {
      company: "none",
      franchises: "assigned",
      workers: "self",
      auditLogs: "self",
      customers: "none",
      revenue: "none",
      contractorInvoices: "none",
      globalIndexes: "none",
      community: "all"
    }
  };
  let profileSaved = false;
  let signoffPosted = false;
  let employeeSessionActive = true;
  let employeeWorkspaceRevision = "employee-revision-0";
  let uploadedEmployeePhotoAsset = null;
  let workspaceState = {
    tasks: [{
      id: "TASK-EMP-1",
      title: "Complete employee smoke ticket",
      assigneeId: worker.uid,
      assigneeEmail: worker.email,
      assigneeName: worker.displayName,
      moduleKey: "photos",
      relatedJob: "J-EMP-1",
      due: "2026-07-25",
      status: "Open",
      priority: "High"
    }],
    jobBoards: [{
      id: "JOB-EMP-1",
      jobId: "J-EMP-1",
      title: "Employee smoke job",
      customer: "Smoke Customer",
      property: "1 Test Street",
      stage: "Field work",
      owner: worker.displayName,
      gates: [],
      linkedModules: ["photos", "time"]
    }],
    timeEntries: [],
    files: [{
      id: "FILE-EMP-ASSIGNMENT",
      moduleKey: "team",
      linkedModuleKeys: ["jobs", "photos", "time"],
      sourceType: "taskAssignment",
      sourceId: "TASK-EMP-1",
      taskId: "TASK-EMP-1",
      relatedJob: "J-EMP-1",
      workerId: worker.uid,
      workerEmail: worker.email,
      title: "Employee smoke assignment file",
      type: "Task assignment",
      owner: worker.displayName,
      status: "Open",
      priority: "High",
      notes: "Complete through the GPS ticket workflow."
    }]
  };
  const employeeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 42.45, longitude: -73.245 },
    permissions: ["geolocation"]
  });
  await employeeContext.addInitScript(() => {
    if (sessionStorage.getItem("employee-cache-seeded")) return;
    localStorage.setItem("brothers-os-workspace-v2", JSON.stringify({
      files: [{ id: "OWNER-ONLY-CACHED-FILE", title: "Owner-only cached revenue file", moduleKey: "payments" }],
      jobBoards: [{ id: "OWNER-ONLY-CACHED-JOB", jobId: "J-PRIVATE", title: "Owner-only cached job" }]
    }));
    sessionStorage.setItem("employee-cache-seeded", "1");
  });
  await employeeContext.grantPermissions(["geolocation"], { origin });
  const page = await employeeContext.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (status, body) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
    if (url.pathname === "/api/auth/config") {
      return json(200, {
        success: true,
        firebase: {
          enabled: true,
          ready: true,
          adminConfigured: true,
          webConfigured: true,
          allowedSignInProviders: ["google.com"],
          ownerOnlyLogin: true,
          allowedLoginEmails: ["david@brothersrestoration.org"],
          sessionTtlHours: 48,
          inviteEmailConfigured: true,
          missingAdminEnv: [],
          missingWebEnv: [],
          apiKey: "smoke-api-key",
          authDomain: "brothers-restoration-website.firebaseapp.com",
          projectId: "brothers-restoration-website",
          storageBucket: "brothers-restoration-website.firebasestorage.app",
          appId: "smoke-app-id",
          messagingSenderId: "80592032671"
        }
      });
    }
    if (url.pathname === "/api/auth/session" && method === "GET") {
      if (!employeeSessionActive) return json(401, { success: false, message: "Authentication is required." });
      return json(200, {
        success: true,
        session: {
          uid: worker.uid,
          email: worker.email,
          roleId: worker.roleId,
          companyId: worker.companyId,
          franchiseIds: worker.franchiseIds,
          contractorId: worker.contractorId,
          accessScope: "employee_portal",
          accessExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          visibleTabIds: worker.visibleTabIds,
          visiblePageIds: worker.visiblePageIds,
          permissions: workerPermissions
        },
        user: worker,
        users: [],
        roles: [{ id: "worker", label: "Worker", rank: 10 }],
        permissions: [{ roleId: "worker", ...workerPermissions }],
        tabs: workerModuleKeys.map((key, index) => ({
          id: key,
          key,
          label: smokeModuleDefinitions.find((module) => module.key === key)?.label || key,
          order: index + 1,
          visible: true
        })),
        pages: workerModuleKeys.map((key, index) => ({
          id: key,
          key,
          moduleKey: key,
          title: smokeModuleDefinitions.find((module) => module.key === key)?.label || key,
          order: index + 1,
          visible: true
        })),
        pageSections: [],
        companySettings: {},
        franchiseSettings: [],
        auditLogs: [],
        businessData: [],
        accessRequests: [],
        accessGrants: [],
        ticketSignoffs: [],
        communityPosts: []
      });
    }
    if (url.pathname === "/api/workspace-state" && method === "GET") {
      return json(200, {
        success: true,
        durable: true,
        exists: true,
        recordCount: workspaceState.tasks.length + workspaceState.jobBoards.length,
        updatedAt: new Date().toISOString(),
        revision: employeeWorkspaceRevision,
        workspaceState
      });
    }
    if (url.pathname === "/api/workspace-state" && method === "PUT") {
      const payload = request.postDataJSON() || {};
      if (payload.baseRevision !== employeeWorkspaceRevision) {
        return json(409, { success: false, message: "Employee smoke workspace revision conflict." });
      }
      workspaceState = payload.workspaceState || workspaceState;
      employeeWorkspaceRevision = `employee-revision-${Date.now()}`;
      return json(200, {
        success: true,
        durable: true,
        savedRecords: 1,
        ignoredRecords: 0,
        updatedAt: new Date().toISOString(),
        revision: employeeWorkspaceRevision
      });
    }
    if (url.pathname === "/api/workspace-assets" && method === "POST") {
      const payload = request.postDataJSON() || {};
      uploadedEmployeePhotoAsset = {
        id: "EMPLOYEE-SMOKE-ASSET",
        assetUrl: `${origin}/api/workspace-assets/EMPLOYEE-SMOKE-ASSET`,
        jobId: payload.jobId,
        taskId: payload.taskId,
        fileName: payload.fileName,
        contentType: payload.contentType
      };
      return json(201, { success: true, asset: uploadedEmployeePhotoAsset });
    }
    if (url.pathname.startsWith("/api/workspace-assets/") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "image/png", body: smokePng });
    }
    if (url.pathname === "/api/employee/profile" && method === "PATCH") {
      profileSaved = true;
      Object.assign(worker, request.postDataJSON() || {});
      return json(200, { success: true, user: worker });
    }
    if (url.pathname === "/api/employee/ticket-signoffs" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const durablePhoto = (workspaceState.photoRecords || []).find((photo) => {
        return photo.taskId === payload.taskId && photo.assetId === uploadedEmployeePhotoAsset?.id;
      });
      if (!durablePhoto) {
        return json(409, { success: false, message: "Upload and save the required photo evidence before signing this ticket." });
      }
      signoffPosted = true;
      employeeWorkspaceRevision = `employee-signoff-revision-${Date.now()}`;
      return json(201, {
        success: true,
        workspaceRevision: employeeWorkspaceRevision,
        signoff: {
          id: "SIGNOFF-SMOKE-1",
          taskId: payload.taskId,
          taskTitle: "Complete employee smoke ticket",
          jobId: "J-EMP-1",
          employeeUid: worker.uid,
          employeeEmail: worker.email,
          employeeName: worker.displayName,
          employerUid: worker.employerUid,
          employerEmail: worker.employerEmail,
          employerContractorId: worker.employerContractorId,
          typedSignature: payload.typedSignature,
          gps: payload.gps,
          status: "signed",
          signedAt: new Date().toISOString()
        },
        task: { ...workspaceState.tasks[0], status: "Complete" }
      });
    }
    if (url.pathname === "/api/auth/session/logout" && method === "POST") {
      employeeSessionActive = false;
      return json(200, { success: true });
    }
    return json(404, { success: false, message: `Employee smoke route not configured: ${method} ${url.pathname}` });
  });

  const employeeSmokeUrl = `${baseUrl}/?employee-smoke=${Date.now()}`;
  await page.goto(`${employeeSmokeUrl}#module/globalindexes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell");
  const staleOwnerCacheRetained = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("brothers-os-workspace-v2") || "{}");
    return (stored.files || []).some((file) => file.id === "OWNER-ONLY-CACHED-FILE")
      || (stored.jobBoards || []).some((job) => job.id === "OWNER-ONLY-CACHED-JOB");
  });
  if (staleOwnerCacheRetained || (await page.locator("body").innerText()).includes("Owner-only cached")) {
    throw new Error("Authenticated worker retained owner records from the previous browser cache");
  }
  const secureEmployeeGlobalView = await page.locator("h1").textContent();
  if (/Global Indexes/i.test(secureEmployeeGlobalView || "")) {
    throw new Error("Authenticated worker can open global indexes after a hard reload");
  }
  await go(page, "jobs");
  if (await page.locator('form[data-form="job-record"]').count()) {
    throw new Error("Employee portal rendered an owner-level Add Job form");
  }
  const assignmentCard = page.locator(".file-card").filter({ hasText: "Employee smoke assignment file" });
  if (await assignmentCard.count() !== 1) throw new Error("Employee assignment file did not render");
  if (await assignmentCard.locator('[data-action="complete-file"], [data-action="duplicate-file"]').count()) {
    throw new Error("Employee assignment file exposed a contradictory completion or copy action");
  }
  await assignmentCard.locator('[data-action="select-file"]').click();
  const assignmentDetail = page.locator(".detail-panel").filter({ hasText: "Employee smoke assignment file" });
  if (await assignmentDetail.locator('[data-action="complete-file"], [data-action="delete-file"], [data-action="status-review"]').count()) {
    throw new Error("Employee assignment detail exposed owner-managed file actions");
  }
  await page.evaluate(() => {
    window.location.hash = "module/time";
  });
  await page.waitForSelector('form[data-form="employee-profile"]');
  actionCoverage.formsRendered.add("employee-profile");
  actionCoverage.formsRendered.add("ticket-signoff");
  await fill(page, 'form[data-form="employee-profile"] input[name="phone"]', "555-444-1212");
  await click(page, 'form[data-form="employee-profile"] button[type="submit"]');
  await waitUntil("employee profile save", () => profileSaved);

  await go(page, "photos");
  await select(page, 'form[data-form="photo-evidence"] select[name="jobId"]', "J-EMP-1");
  await select(page, 'form[data-form="photo-evidence"] select[name="taskId"]', "TASK-EMP-1");
  await fill(page, 'form[data-form="photo-evidence"] input[name="room"]', "Employee smoke room");
  await page.locator('form[data-form="photo-evidence"] input[name="photoFile"]').setInputFiles({
    name: "employee-smoke-photo.png",
    mimeType: "image/png",
    buffer: smokePng
  });
  await click(page, 'form[data-form="photo-evidence"] button[type="submit"]');
  await expectBody(page, "photo evidence keeps ticket open", "sign the ticket with GPS to complete it");
  await go(page, "time");
  await page.waitForSelector('form[data-form="ticket-signoff"]');
  await page.locator('form[data-form="ticket-signoff"] input[name="attested"]').check();
  await click(page, 'form[data-form="ticket-signoff"] button[type="submit"]');
  await waitUntil("employee ticket sign-off", () => signoffPosted);
  await expectBody(page, "employee ticket completed", "No open assigned tickets");
  const employeeLogoutResponsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/api/auth/session/logout"
      && response.request().method() === "POST";
  }, { timeout: 20000 });
  await clickAny(page, 'button[data-action="employee-logout"]', "employee portal sign out");
  const employeeLogoutResponse = await employeeLogoutResponsePromise;
  if (!employeeLogoutResponse.ok()) throw new Error("Employee portal logout endpoint rejected the sign-out request");
  await page.waitForSelector('button[data-action="firebase-google-login"]', { timeout: 20000 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".auth-gate", { timeout: 15000 });
  results.workflowChecks.push({ label: "Employee portal", text: "restricted account, employer-bound task, GPS ticket sign-off" });
  console.log("[smoke] employee portal verified");
  await employeeContext.close();
}

const allOwnerActions = [
  "manageUsers", "removeUsers", "changeRoles", "disableAccounts", "resetPermissions",
  "manageRolePermissions", "manageTabs", "managePages", "manageSections", "manageButtons",
  "uploadImages", "editCompanySettings", "editFranchiseSettings", "viewCompanyReports",
  "viewFranchiseReports", "viewAuditLogs", "viewCustomerDirectory", "viewRevenueData",
  "viewContractorInvoices", "viewGlobalIndexes", "manageAccessGrants", "inviteWorkers", "issueContractorCodes",
  "postCommunityMessages", "moderateCommunityMessages", "editAssignedTasks", "editAllTasks"
];

async function installLocalSmokeApi(context, { adminConfigured = true } = {}) {
  let workspaceState = {};
  let workspaceWriteCount = 0;
  let workspaceRevision = "owner-revision-0";
  let sessionActive = true;
  const emergencyIncidents = [];
  let emergencySources = [];
  const wave = Buffer.alloc(44 + 16000);
  wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(16000, 40);
  await context.route("**/smoke-radio.wav", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: wave }));
  const owner = {
    id: "smoke-owner",
    uid: "smoke-owner",
    email: "david@brothersrestoration.org",
    displayName: "David",
    roleId: "super_admin",
    companyId: "default-company",
    franchiseIds: ["default-franchise"],
    status: "active",
    disabled: false
  };
  await context.addInitScript((workspaceIdentity) => {
    if (sessionStorage.getItem("owner-workspace-identity-seeded")) return;
    const saved = JSON.parse(localStorage.getItem("brothers-os-workspace-v2") || "{}");
    localStorage.setItem("brothers-os-workspace-v2", JSON.stringify({ ...saved, workspaceIdentity }));
    sessionStorage.setItem("owner-workspace-identity-seeded", "1");
  }, { uid: owner.uid, companyId: owner.companyId });
  const users = [owner];
  const accessGrants = [];
  const posts = [];
  const tabs = smokeModuleDefinitions.map((module, index) => ({
    id: module.key,
    key: module.key,
    label: module.label,
    order: index + 1,
    visible: true
  }));
  const pages = [
    { id: "daily-page", tabId: "daily", moduleKey: "daily", title: "Daily Owner Dashboard", purpose: "Owner command center", order: 1, visible: true }
  ];
  const pageSections = [
    {
      id: "daily-priority",
      pageId: "daily-page",
      title: "Daily priorities",
      visible: true,
      order: 1,
      imageUrl: "",
      content: { heading: "Daily priorities", body: "Owner-reviewed work queue.", buttons: [{ label: "Open jobs", url: "#module/jobs" }] }
    },
    {
      id: "access-security",
      pageId: "accessadmin",
      title: "Access security",
      visible: true,
      order: 1,
      imageUrl: "",
      content: { heading: "Access security", body: "Owner-controlled user access.", buttons: [{ label: "Open team", url: "#module/team" }] }
    }
  ];
  const insuranceSubmissions = [
    {
      id: `insurance-smoke-${stamp}`,
      fullName: `Insurance Customer ${stamp}`,
      phone: "555-111-2222",
      email: `insurance.${stamp}@example.com`,
      propertyAddress: `500 Claim Street ${stamp}`,
      insuranceCompanyName: "Smoke Mutual",
      claimNumber: `CLM-${stamp}`,
      policyNumber: `POL-${stamp}`,
      damageDescription: "Automated water-loss intake verification.",
      uploadedFiles: [],
      status: "new",
      internalNotes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  const permissions = {
    tabs: { mode: "all", allowed: [], hidden: [] },
    pages: { mode: "all", allowed: [], hidden: [] },
    sections: { mode: "all", allowed: [], hidden: [] },
    actions: Object.fromEntries(allOwnerActions.map((action) => [action, true])),
    dataAccess: {
      company: "all",
      franchises: "all",
      workers: "all",
      auditLogs: "all",
      customers: "all",
      revenue: "all",
      contractorInvoices: "all",
      globalIndexes: "all",
      community: "all"
    }
  };
  const sessionPayload = () => ({
    success: true,
    session: {
      uid: owner.uid,
      email: owner.email,
      roleId: owner.roleId,
      companyId: owner.companyId,
      franchiseIds: owner.franchiseIds,
      contractorId: "",
      accessScope: "owner",
      accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      permissions
    },
    user: owner,
    users,
    roles: [
      { id: "super_admin", label: "Super Admin", rank: 100 },
      { id: "business_owner", label: "Business Owner", rank: 70 },
      { id: "franchise_owner", label: "Franchise Owner", rank: 50 },
      { id: "contractor", label: "Contractor", rank: 30 },
      { id: "worker", label: "Worker", rank: 10 }
    ],
    permissions: [{ roleId: "super_admin", ...permissions }],
    tabs,
    pages,
    pageSections,
    companySettings: {
      id: "default",
      brandName: "Brothers",
      brandLogoUrl: "/logo.png",
      editModeEnabled: true
    },
    franchiseSettings: [],
    auditLogs: [],
    businessData: [],
    accessRequests: [],
    accessGrants,
    ticketSignoffs: [],
    communityPosts: posts
  });

  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (status, body) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });

    if (url.pathname === "/api/auth/config") {
      return json(200, {
        success: true,
        firebase: {
          enabled: true,
          ready: true,
          adminConfigured,
          webConfigured: true,
          restAuthFallback: false,
          projectId: "brothers-restoration-website",
          allowedSignInProviders: ["google.com"],
          ownerOnlyLogin: true,
          allowedLoginEmails: [owner.email],
          missingAdminEnv: [],
          missingWebEnv: [],
          sessionTtlHours: 48,
          inviteEmailConfigured: true,
          apiKey: "smoke-api-key",
          authDomain: "brothers-restoration-website.firebaseapp.com",
          storageBucket: "brothers-restoration-website.firebasestorage.app",
          appId: "smoke-app-id",
          messagingSenderId: "80592032671"
        }
      });
    }
    if (url.pathname === "/api/auth/session" && method === "GET") {
      return sessionActive
        ? json(200, sessionPayload())
        : json(401, { success: false, message: "Authentication is required." });
    }
    if (url.pathname === "/api/auth/session/logout" && method === "POST") {
      sessionActive = false;
      return json(200, { success: true });
    }
    if (url.pathname === "/api/workspace-state" && method === "GET") {
      return json(200, {
        success: true,
        durable: true,
        exists: Object.keys(workspaceState).length > 0,
        recordCount: Object.values(workspaceState).filter(Array.isArray).reduce((sum, items) => sum + items.length, 0),
        updatedAt: new Date().toISOString(),
        revision: workspaceRevision,
        workspaceState
      });
    }
    if (url.pathname === "/api/workspace-state" && method === "PUT") {
      const payload = request.postDataJSON() || {};
      if (payload.baseRevision !== workspaceRevision) {
        return json(409, { success: false, message: "Owner smoke workspace revision conflict." });
      }
      workspaceWriteCount += 1;
      workspaceState = payload.workspaceState || {};
      workspaceRevision = `owner-revision-${workspaceWriteCount}`;
      return json(200, {
        success: true,
        durable: true,
        savedRecords: Object.values(workspaceState).filter(Array.isArray).reduce((sum, items) => sum + items.length, 0),
        ignoredRecords: 0,
        updatedAt: new Date().toISOString(),
        revision: workspaceRevision
      });
    }
    if (url.pathname === "/api/emergency/status" && method === "GET") {
      return json(200, { success: true, configured: emergencySources.length > 0, sources: emergencySources, runtime: { available: adminConfigured, storage: "firestore" } });
    }
    if (url.pathname === "/api/emergency/incidents" && method === "GET") {
      return json(200, { success: true, incidents: emergencyIncidents });
    }
    if (url.pathname === "/api/emergency/incidents" && method === "POST") {
      const payload = request.postDataJSON();
      const existing = emergencyIncidents.find((item) => item.eventId === payload.eventId);
      if (existing) return json(200, { success: true, id: existing.id, duplicate: true });
      const incident = { ...payload, id: String(emergencyIncidents.length + 1).padStart(64, "0"), companyId: owner.companyId, sourceLabel: "Manual report", reviewStatus: "new", receivedAt: new Date().toISOString(), linkedRecordId: null };
      emergencyIncidents.unshift(incident);
      return json(201, { success: true, id: incident.id, duplicate: false });
    }
    if (url.pathname.startsWith("/api/emergency/incidents/") && method === "PATCH") {
      const incident = emergencyIncidents.find((item) => item.id === url.pathname.split("/").at(-1));
      if (!incident) return json(404, { success: false, message: "Incident not found" });
      Object.assign(incident, request.postDataJSON());
      return json(200, { success: true, incident });
    }
    if (url.pathname === "/api/rbac/users" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const user = {
        id: `smoke-user-${users.length}`,
        uid: `smoke-user-${users.length}`,
        email: payload.email,
        displayName: payload.displayName,
        roleId: payload.roleId || "worker",
        companyId: payload.companyId || "default-company",
        franchiseIds: payload.franchiseIds || [],
        contractorId: payload.contractorId || "",
        assignedJobIds: payload.assignedJobIds || [],
        assignedTaskIds: payload.assignedTaskIds || [],
        visibleTabIds: payload.visibleTabIds || [],
        visiblePageIds: payload.visiblePageIds || [],
        status: "pending_access",
        disabled: false
      };
      users.push(user);
      return json(201, {
        success: true,
        user,
        grant: { id: `smoke-grant-${users.length}`, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() },
        accessCode: payload.accessCode || `EMP-SMOKE-${users.length}`,
        accessLink: `${origin}/#access/smoke-${users.length}`,
        emailDelivery: { status: "sent" }
      });
    }
    if (/^\/api\/rbac\/users\/[^/]+$/.test(url.pathname) && method === "PATCH") {
      const uid = decodeURIComponent(url.pathname.split("/").at(-1));
      const payload = request.postDataJSON() || {};
      const index = users.findIndex((user) => user.uid === uid);
      const user = { ...(index >= 0 ? users[index] : { uid, id: uid }), ...payload };
      if (index >= 0) users[index] = user;
      else users.push(user);
      return json(200, { success: true, user });
    }
    if (/^\/api\/rbac\/users\/[^/]+$/.test(url.pathname) && method === "DELETE") {
      const uid = decodeURIComponent(url.pathname.split("/").at(-1));
      const index = users.findIndex((user) => user.uid === uid);
      if (index > 0) users.splice(index, 1);
      return json(200, { success: true });
    }
    if (/^\/api\/employees\/[^/]+\/assignments$/.test(url.pathname) && method === "PATCH") {
      const uid = decodeURIComponent(url.pathname.split("/")[3]);
      const payload = request.postDataJSON() || {};
      const index = users.findIndex((user) => user.uid === uid);
      if (index < 0 || users[index].roleId !== "worker") {
        return json(404, { success: false, message: "Employee not found." });
      }
      users[index] = {
        ...users[index],
        assignedJobIds: payload.assignedJobIds || [],
        assignedTaskIds: payload.assignedTaskIds || []
      };
      return json(200, { success: true, user: users[index] });
    }
    if (url.pathname === "/api/access/grants" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const accessCode = `GRANT${stamp}`;
      return json(201, {
        success: true,
        grant: {
          id: `smoke-grant-${Date.now()}`,
          email: payload.email,
          roleId: payload.roleId || "contractor",
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        },
        accessCode,
        accessLink: `${origin}/#access/smoke-grant-${stamp}`,
        emailDelivery: { status: "sent" }
      });
    }
    if (url.pathname === "/api/employee-invitations" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const grant = {
        id: `employee-grant-${Date.now()}`,
        email: payload.email,
        displayName: payload.displayName,
        roleId: "worker",
        contractorId: payload.contractorId || `contractor-${stamp}`,
        employerUid: owner.uid,
        employerEmail: owner.email,
        onboardingMode: "employee_link",
        status: "issued",
        phone: payload.phone || "",
        jobTitle: payload.jobTitle || "Field employee",
        employmentType: payload.employmentType || "Employee",
        startDate: payload.startDate || "",
        visibleTabIds: payload.visibleModuleKeys || [],
        visiblePageIds: payload.visibleModuleKeys || [],
        assignedJobIds: payload.assignedJobIds || [],
        assignedTaskIds: payload.assignedTaskIds || [],
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      };
      accessGrants.unshift(grant);
      return json(201, {
        success: true,
        grant,
        accessLink: `${origin}/?portal=employee#access/employee-${stamp}`,
        emailDelivery: { status: "sent" }
      });
    }
    if (/^\/api\/employee-invitations\/[^/]+$/.test(url.pathname) && method === "PATCH") {
      const grantId = decodeURIComponent(url.pathname.split("/").at(-1));
      const payload = request.postDataJSON() || {};
      const index = accessGrants.findIndex((grant) => grant.id === grantId);
      if (index < 0) return json(404, { success: false, message: "Employee invitation not found." });
      accessGrants[index] = {
        ...accessGrants[index],
        ...payload,
        visibleTabIds: payload.visibleModuleKeys || accessGrants[index].visibleTabIds,
        visiblePageIds: payload.visibleModuleKeys || accessGrants[index].visiblePageIds,
        updatedAt: new Date().toISOString()
      };
      return json(200, { success: true, grant: accessGrants[index] });
    }
    if (/^\/api\/employee-invitations\/[^/]+$/.test(url.pathname) && method === "DELETE") {
      const grantId = decodeURIComponent(url.pathname.split("/").at(-1));
      const index = accessGrants.findIndex((grant) => grant.id === grantId);
      if (index < 0) return json(404, { success: false, message: "Employee invitation not found." });
      accessGrants[index] = {
        ...accessGrants[index],
        status: "revoked",
        revokedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return json(200, { success: true, grant: accessGrants[index] });
    }
    if (url.pathname === "/api/community/posts" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const post = {
        id: `smoke-post-${posts.length + 1}`,
        ...payload,
        authorEmail: owner.email,
        authorRoleId: owner.roleId,
        comments: [],
        createdAt: new Date().toISOString()
      };
      posts.unshift(post);
      return json(201, { success: true, post });
    }
    if (/^\/api\/community\/posts\/[^/]+\/comments$/.test(url.pathname) && method === "POST") {
      const postId = decodeURIComponent(url.pathname.split("/")[4]);
      const post = posts.find((item) => item.id === postId);
      const comment = {
        id: `smoke-comment-${Date.now()}`,
        body: request.postDataJSON()?.body || "",
        authorEmail: owner.email,
        authorRoleId: owner.roleId,
        createdAt: new Date().toISOString()
      };
      if (post) post.comments.push(comment);
      return json(201, { success: true, comment });
    }
    if (url.pathname === "/api/insurance-intake" && method === "GET") {
      const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
      const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
      const submissions = insuranceSubmissions.filter((submission) => {
        const searchable = [
          submission.fullName,
          submission.phone,
          submission.email,
          submission.claimNumber,
          submission.policyNumber,
          submission.propertyAddress,
          submission.insuranceCompanyName
        ].join(" ").toLowerCase();
        return (!search || searchable.includes(search))
          && (!status || String(submission.status || "").toLowerCase() === status);
      });
      return json(200, { success: true, submissions });
    }
    if (/^\/api\/insurance-intake\/[^/]+$/.test(url.pathname) && method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      const submission = insuranceSubmissions.find((item) => item.id === id);
      return submission
        ? json(200, { success: true, submission })
        : json(404, { success: false, message: "Insurance submission not found." });
    }
    if (/^\/api\/insurance-intake\/[^/]+\/status$/.test(url.pathname) && method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      const submission = insuranceSubmissions.find((item) => item.id === id);
      if (submission) {
        submission.status = request.postDataJSON()?.status || submission.status;
        submission.updatedAt = new Date().toISOString();
      }
      return submission
        ? json(200, { success: true, submission })
        : json(404, { success: false, message: "Insurance submission not found." });
    }
    if (/^\/api\/insurance-intake\/[^/]+\/notes$/.test(url.pathname) && method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      const submission = insuranceSubmissions.find((item) => item.id === id);
      if (submission) {
        submission.internalNotes = request.postDataJSON()?.notes || "";
        submission.updatedAt = new Date().toISOString();
      }
      return submission
        ? json(200, { success: true, submission })
        : json(404, { success: false, message: "Insurance submission not found." });
    }
    if (url.pathname.startsWith("/api/payments/") && method === "POST") {
      const payload = request.postDataJSON() || {};
      const rail = url.pathname.includes("paypal")
        ? "PayPal"
        : url.pathname.includes("zelle")
          ? "Zelle"
          : url.pathname.includes("wire")
            ? "Wire"
            : "Card";
      if (rail === "Card") {
        return json(201, {
          success: true,
          rail,
          status: "ready",
          message: "Secure Stripe Checkout session created.",
          providerId: `cs_smoke_${stamp}`,
          checkoutUrl: `https://checkout.stripe.com/c/pay/cs_smoke_${stamp}?request=${encodeURIComponent(payload.requestId || "")}`,
          requestedAmount: Number(payload.amount || 0),
          customer: payload.customer || "",
          job: payload.job || "",
          requestId: payload.requestId || ""
        });
      }
      return json(202, {
        success: true,
        rail,
        status: "configuration_required",
        message: `${rail} smoke provider configuration is intentionally unavailable.`,
        requestedAmount: Number(payload.amount || 0),
        customer: payload.customer || "",
        job: payload.job || "",
        requestId: payload.requestId || ""
      });
    }
    if (url.pathname === "/api/integrations/quickbooks/oauth/start" && method === "GET") {
      return json(202, {
        success: true,
        integration: "QuickBooks",
        status: "configuration_required",
        message: "QuickBooks smoke credentials are intentionally unavailable."
      });
    }
    if (url.pathname === "/api/rbac/assets" && method === "POST") {
      return json(201, { success: true, assetUrl: `${origin}/logo.png` });
    }
    if (url.pathname === "/api/workspace-assets" && method === "POST") {
      const payload = request.postDataJSON() || {};
      const id = `SMOKE-ASSET-${Date.now()}`;
      return json(201, {
        success: true,
        asset: {
          id,
          assetUrl: `${origin}/api/workspace-assets/${id}`,
          jobId: payload.jobId || "",
          taskId: payload.taskId || "",
          fileName: payload.fileName || "smoke-photo.png",
          contentType: payload.contentType || "image/png"
        }
      });
    }
    if (url.pathname.startsWith("/api/workspace-assets/") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "image/png", body: smokePng });
    }
    if (url.pathname.startsWith("/api/rbac/") || url.pathname.startsWith("/api/access/")) {
      return json(200, { success: true, users, posts });
    }
    return route.continue();
  });

  return {
    getWorkspaceState: () => workspaceState,
    getEmergencyIncidents: () => emergencyIncidents,
    enableTestRadio: () => { emergencySources = [{ id: "test-radio", label: "Test dispatch radio", area: "Local fixture only", streamUrl: `${origin}/smoke-radio.wav` }]; },
    getWorkspaceWriteCount: () => workspaceWriteCount,
    injectLegacyRecords() {
      const moduleRecord = {
        id: `legacy-browser-${stamp}`,
        moduleKey: "retired-browser-module",
        subject: `Legacy browser record ${stamp}`
      };
      const file = {
        id: `legacy-browser-file-${stamp}`,
        moduleKey: "retired-browser-module",
        title: `Legacy browser file ${stamp}`
      };
      const taskAssignmentFile = {
        id: `legacy-browser-task-file-${stamp}`,
        moduleKey: "team",
        sourceType: "taskAssignment",
        taskModuleKey: "retired-browser-module",
        title: `Legacy task-assignment file ${stamp}`
      };
      const task = {
        id: `legacy-browser-task-${stamp}`,
        moduleKey: "retired-browser-module",
        title: `Legacy browser task ${stamp}`
      };
      workspaceState = {
        ...workspaceState,
        moduleRecords: [
          ...(Array.isArray(workspaceState.moduleRecords) ? workspaceState.moduleRecords : [])
            .filter((record) => record.id !== moduleRecord.id),
          moduleRecord
        ],
        files: [
          ...(Array.isArray(workspaceState.files) ? workspaceState.files : [])
            .filter((record) => ![file.id, taskAssignmentFile.id].includes(record.id)),
          file,
          taskAssignmentFile
        ],
        tasks: [
          ...(Array.isArray(workspaceState.tasks) ? workspaceState.tasks : [])
            .filter((record) => record.id !== task.id),
          task
        ]
      };
      workspaceRevision = `owner-revision-external-${Date.now()}`;
      return structuredClone({ moduleRecord, file, taskAssignmentFile, task });
    },
    setSessionActive(value) {
      sessionActive = Boolean(value);
    }
  };
}

async function launchSmokeBrowser() {
  const options = { headless: true, timeout: 30000 };
  if (process.platform === "win32") {
    try {
      return await chromium.launch({ ...options, channel: "msedge" });
    } catch (error) {
      console.warn(`[smoke] Microsoft Edge was unavailable; using isolated Chromium. ${error.message}`);
    }
  }
  return chromium.launch(options);
}

const browser = await launchSmokeBrowser();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  geolocation: { latitude: 42.45, longitude: -73.245 },
  permissions: ["geolocation"]
});
await context.grantPermissions(["geolocation"], { origin });
const localSmokeApi = ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)
  ? await installLocalSmokeApi(context)
  : null;
const page = await context.newPage();
page.setDefaultTimeout(8000);
const consoleErrors = [];
const developmentDiagnostics = [];
const failedResponses = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const messageText = message.text();
  if (messageText.includes("status of 401 (Unauthorized)")) {
    return;
  }
  const isLocalReactDevelopmentDiagnostic = ["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)
    && messageText.includes("React requires eval() in development mode")
    && messageText.includes("React will never use eval() in production mode");
  if (isLocalReactDevelopmentDiagnostic) {
    developmentDiagnostics.push(messageText);
    return;
  }
  consoleErrors.push(messageText);
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const pathname = new URL(response.url()).pathname;
      if (response.status() === 401 && pathname === "/api/auth/session") return;
      failedResponses.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    }
});

let smokePassed = false;
try {
  const moduleKeys = await safeModuleSweep(page);
  console.log("[smoke] module sweep complete");
  await testResponsiveInputs(page, localSmokeApi);
  await testEmergencyMonitor(page, localSmokeApi);
  await exerciseDataFieldControls(page);
  await runWorkflow(page, localSmokeApi);
  console.log("[smoke] linked workflow complete");
  await verifyGenericModuleConnectivity(page, moduleKeys);
  console.log("[smoke] semantic generic-module verification complete");
  await submitRemainingForms(page);
  console.log("[smoke] all form paths submitted");
  await refreshCoverage(page, moduleKeys);
  await verifyDurableReload(page, localSmokeApi);
  console.log("[smoke] durable reload verified");
  await verifyLegacyBrowserRoundTrip(page, localSmokeApi);
  console.log("[smoke] legacy browser round-trip verified");
  await refreshCoverage(page, moduleKeys);
  await testEmployeeGoogleSwitch(page, localSmokeApi);
  console.log("[smoke] employee Google switch verified");
  await exerciseRemainingActions(page);
  console.log("[smoke] action matrix complete");
  await testUnauthenticatedGate(browser);
  await testUnavailableStorageWriteLock(browser);
  await testEmployeePortal(browser);
  const allowedInteractiveActions = new Set(["firebase-google-login"]);
  const unexercisedActionTypes = staticActionTypes
    .filter((action) => !actionCoverage.exercised.has(action) && !allowedInteractiveActions.has(action));
  const unsubmittedFormTypes = staticFormTypes
    .filter((formType) => !actionCoverage.formsSubmitted.has(formType));
  const unrenderedFieldTypes = staticFieldTypes
    .filter((fieldType) => !actionCoverage.fieldsRendered.has(fieldType));
  const unexercisedFieldTypes = staticFieldTypes
    .filter((fieldType) => !actionCoverage.fieldsExercised.has(fieldType));
  results.actionTypesExercised = actionCoverage.exercised.size;
  results.formTypesSubmitted = actionCoverage.formsSubmitted.size;
  results.fieldTypesExercised = actionCoverage.fieldsExercised.size;
  results.coverage = {
    expectedActionTypes: staticActionTypes,
    expectedFormTypes: staticFormTypes,
    expectedFieldTypes: staticFieldTypes,
    renderedActionTypes: [...actionCoverage.rendered].sort(),
    exercisedActionTypes: [...actionCoverage.exercised].sort(),
    renderedFormTypes: [...actionCoverage.formsRendered].sort(),
    submittedFormTypes: [...actionCoverage.formsSubmitted].sort(),
    renderedFieldTypes: [...actionCoverage.fieldsRendered].sort(),
    exercisedFieldTypes: [...actionCoverage.fieldsExercised].sort(),
    fieldLocations: Object.fromEntries([...actionCoverage.fieldLocations.entries()].sort(([left], [right]) => left.localeCompare(right))),
    interactiveProviderBoundaries: [...allowedInteractiveActions],
    unexercisedActionTypes,
    unsubmittedFormTypes,
    unrenderedFieldTypes,
    unexercisedFieldTypes
  };
  if (unexercisedActionTypes.length) {
    throw new Error(`Action types not exercised: ${unexercisedActionTypes.join(", ")}`);
  }
  if (unsubmittedFormTypes.length) {
    throw new Error(`Form types not submitted: ${unsubmittedFormTypes.join(", ")}`);
  }
  if (unrenderedFieldTypes.length) {
    throw new Error(`Data-field types not rendered: ${unrenderedFieldTypes.join(", ")}`);
  }
  if (unexercisedFieldTypes.length) {
    throw new Error(`Data-field types not exercised: ${unexercisedFieldTypes.join(", ")}`);
  }
  if (consoleErrors.length || failedResponses.length) {
    throw new Error(`Browser errors during smoke: ${[...new Set([...consoleErrors, ...failedResponses])].join(" | ")}`);
  }
  fs.mkdirSync(new URL("../logs/", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("../logs/browser-workflow-smoke.json", import.meta.url), JSON.stringify({ ok: true, ...results }, null, 2));
  await new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify({ ok: true, ...results }, null, 2)}\n`, resolve);
  });
  smokePassed = true;
} catch (error) {
  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    heading: document.querySelector("h1")?.textContent?.trim() || "",
    body: document.body.innerText.slice(0, 1200),
    forms: [...document.querySelectorAll("form[data-form]")].map((form) => form.dataset.form),
    toast: document.querySelector(".toast")?.textContent?.trim() || ""
  })).catch(() => ({}));
  console.error(JSON.stringify({ diagnostics, consoleErrors, failedResponses, developmentDiagnostics }, null, 2));
  throw error;
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (smokePassed) process.exit(0);
}
