import { chromium } from "playwright";
import fs from "node:fs";

const baseUrl = process.env.BROTHERS_OS_BASE_URL || "http://127.0.0.1:4198";
const origin = new URL(baseUrl).origin;
const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const moduleDataSource = fs.readFileSync(new URL("../module-data.js", import.meta.url), "utf8");
const smokeModuleDefinitions = JSON.parse(moduleDataSource.slice(moduleDataSource.indexOf("["), moduleDataSource.lastIndexOf("]") + 1));
const staticActionTypes = [...new Set([...appSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]))].sort();
const staticFormTypes = [...new Set([...appSource.matchAll(/data-form="([^"]+)"/g)].map((match) => match[1]))].sort();
const stamp = String(Date.now()).slice(-6);
const ids = {
  jobId: `J-AI-${stamp}`,
  jobTitle: `AI workflow water loss ${stamp}`,
  customer: `AI Test Customer ${stamp}`,
  employeeName: `AI Test Tech ${stamp}`,
  employeeEmail: `ai.tech.${stamp}@example.com`,
  accessCode: `EMP${stamp}`,
  taskTitle: `Upload kitchen invoice photos ${stamp}`,
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
  workflowChecks: []
};
const actionCoverage = {
  rendered: new Set(),
  exercised: new Set(),
  formsRendered: new Set(),
  formsSubmitted: new Set(),
  actionLocations: new Map(),
  formLocations: new Map()
};

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
  await page.locator("h1").filter({ hasText: /\S/ }).waitFor({ state: "visible", timeout: 8000 });
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

async function collectPageCoverage(page, key) {
  const summary = await page.evaluate(() => ({
    buttons: document.querySelectorAll("button").length,
    forms: document.querySelectorAll("form[data-form]").length,
    actions: [...new Set([...document.querySelectorAll("[data-action]")].map((element) => element.dataset.action).filter(Boolean))],
    formTypes: [...new Set([...document.querySelectorAll("form[data-form]")].map((element) => element.dataset.form).filter(Boolean))],
    inertButtons: [...document.querySelectorAll("button")]
      .filter((button) => !button.disabled && !button.dataset.action && !button.closest("form"))
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
    await submitGenericForm(page, formType);
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

async function runWorkflow(page) {
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

  await go(page, "team");
  await fill(page, 'form[data-form="team-member"] input[name="name"]', ids.employeeName);
  await fill(page, 'form[data-form="team-member"] input[name="email"]', ids.employeeEmail);
  await select(page, 'form[data-form="team-member"] select[name="accountType"]', "Employee");
  await fill(page, 'form[data-form="team-member"] input[name="role"]', "Field technician");
  await fill(page, 'form[data-form="team-member"] input[name="access"]', "Jobs, photos, time, communications");
  await fill(page, 'form[data-form="team-member"] input[name="accessCode"]', ids.accessCode);
  await fill(page, 'form[data-form="team-member"] input[name="assignedJobIds"]', ids.jobId);
  await click(page, 'form[data-form="team-member"] button[type="submit"]');
  await expectBody(page, "employee login created", ids.employeeEmail);

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
  await fill(page, 'form[data-form="photo-evidence"] input[name="photoRef"]', ids.photoRef);
  await fill(page, 'form[data-form="photo-evidence"] textarea[name="notes"]', "AI QA photo evidence should complete the assigned photo task");
  await click(page, 'form[data-form="photo-evidence"] button[type="submit"]');
  await expectBody(page, "photo evidence saved", ids.photoRef);
  await select(page, 'form[data-form="job-note"] select[name="jobId"]', ids.jobId);
  await select(page, 'form[data-form="job-note"] select[name="noteType"]', "Customer update");
  await fill(page, 'form[data-form="job-note"] textarea[name="notes"]', `Customer note for ${ids.jobId} should link to communications and closeout`);
  await click(page, 'form[data-form="job-note"] button[type="submit"]');
  await expectBody(page, "job note saved", `Customer note for ${ids.jobId}`);

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
  await fill(page, 'form[data-form="clock-in"] input[name="job"]', ids.jobId);
  await click(page, 'form[data-form="clock-in"] button[type="submit"]');
  await expectBody(page, "clocked in", "Clocked in");
  await click(page, 'button[data-action="clock-out"]');
  await expectBody(page, "clocked out", ids.employeeName);

  await go(page, "payments");
  await expectBody(page, "payments show linked job", ids.jobId);
  await expectBody(page, "payments show request customer", ids.paymentCustomer);
  await expectBody(page, "payments show equipment invoice", ids.equipmentName);

  await go(page, "team");
  await expectBody(page, "team shows employee", ids.employeeEmail);
  await expectBody(page, "team shows secure portal method", "Google invite plus individual code");
  await expectBody(page, "team shows assigned task", ids.taskTitle);

  await click(page, 'button[data-action="open-employee-login"]');
  await fill(page, 'form[data-form="employee-login"] input[name="identifier"]', ids.employeeEmail);
  await fill(page, 'form[data-form="employee-login"] input[name="code"]', ids.accessCode);
  await click(page, 'form[data-form="employee-login"] button[type="submit"]');
  await expectBody(page, "employee portal opened", "Field worker portal");
  await page.evaluate(() => {
    window.location.hash = "module/globalindexes";
  });
  await page.waitForTimeout(200);
  const employeeGlobalView = await page.locator("h1").textContent();
  if (/Global Indexes/i.test(employeeGlobalView || "")) {
    throw new Error("Employee portal can open global indexes");
  }
  await clickAny(page, 'button[data-action="employee-logout"]', "employee logout");

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

async function verifyDurableReload(page, localSmokeApi) {
  if (!localSmokeApi) return;
  const requiredValues = [
    ids.jobId,
    ids.employeeEmail,
    ids.taskTitle,
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

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 8000 });
  await go(page, "jobs");
  await expectBody(page, "reload retained job", ids.jobId);
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
  results.durableReloadVerified = true;
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
  const prompt = await firstVisible(page.locator('[data-field="ai-copilot-query"]'));
  if (prompt) await prompt.fill(`Summarize ${ids.jobId}`);
  await clickVisibleAction(page, "ai-copilot-ask");
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
  const destructive = ["delete-file", "delete-user"];

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
    if (action === "open-user-manage") {
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
  await page.waitForSelector(".app-shell", { timeout: 8000 });
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
  actionCoverage.formsRendered.add("access-request");
  const disclosure = page.locator('details.auth-disclosure:has(form[data-form="access-request"])');
  if (await disclosure.count()) await disclosure.evaluate((element) => { element.open = true; });
  await submitGenericForm(page, "access-request");
  await expectBody(page, "trial request submitted", "48-hour access request");
  if (!requestSubmitted) throw new Error("Trial request did not reach the protected access API");
  results.workflowChecks.push({ label: "Google login gate", text: "visible account chooser button and 48-hour request path" });
  console.log("[smoke] unauthenticated gate verified");
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
    files: []
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
        workspaceState
      });
    }
    if (url.pathname === "/api/workspace-state" && method === "PUT") {
      workspaceState = request.postDataJSON()?.workspaceState || workspaceState;
      return json(200, { success: true, durable: true, savedRecords: 1, ignoredRecords: 0, updatedAt: new Date().toISOString() });
    }
    if (url.pathname === "/api/employee/profile" && method === "PATCH") {
      profileSaved = true;
      Object.assign(worker, request.postDataJSON() || {});
      return json(200, { success: true, user: worker });
    }
    if (url.pathname === "/api/employee/ticket-signoffs" && method === "POST") {
      const payload = request.postDataJSON() || {};
      signoffPosted = true;
      return json(201, {
        success: true,
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
    if (url.pathname === "/api/auth/session/logout" && method === "POST") return json(200, { success: true });
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
  await page.evaluate(() => {
    window.location.hash = "module/time";
  });
  await page.waitForSelector('form[data-form="employee-profile"]');
  actionCoverage.formsRendered.add("employee-profile");
  actionCoverage.formsRendered.add("ticket-signoff");
  await fill(page, 'form[data-form="employee-profile"] input[name="phone"]', "555-444-1212");
  await click(page, 'form[data-form="employee-profile"] button[type="submit"]');
  await waitUntil("employee profile save", () => profileSaved);

  await page.locator('form[data-form="ticket-signoff"] input[name="attested"]').check();
  await click(page, 'form[data-form="ticket-signoff"] button[type="submit"]');
  await waitUntil("employee ticket sign-off", () => signoffPosted);
  await expectBody(page, "employee ticket completed", "No open assigned tickets");
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

async function installLocalSmokeApi(context) {
  let workspaceState = {};
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
  const users = [owner];
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
    accessGrants: [],
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
          adminConfigured: true,
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
    if (url.pathname === "/api/auth/session" && method === "GET") return json(200, sessionPayload());
    if (url.pathname === "/api/auth/session/logout" && method === "POST") return json(200, { success: true });
    if (url.pathname === "/api/workspace-state" && method === "GET") {
      return json(200, {
        success: true,
        durable: true,
        exists: Object.keys(workspaceState).length > 0,
        recordCount: Object.values(workspaceState).filter(Array.isArray).reduce((sum, items) => sum + items.length, 0),
        updatedAt: new Date().toISOString(),
        workspaceState
      });
    }
    if (url.pathname === "/api/workspace-state" && method === "PUT") {
      workspaceState = request.postDataJSON()?.workspaceState || {};
      return json(200, {
        success: true,
        durable: true,
        savedRecords: Object.values(workspaceState).filter(Array.isArray).reduce((sum, items) => sum + items.length, 0),
        ignoredRecords: 0,
        updatedAt: new Date().toISOString()
      });
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
        assignedJobIds: payload.assignedJobIds || [],
        assignedTaskIds: payload.assignedTaskIds || [],
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      };
      return json(201, {
        success: true,
        grant,
        accessLink: `${origin}/?portal=employee#access/employee-${stamp}`,
        emailDelivery: { status: "sent" }
      });
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
      return json(200, { success: true, submissions: insuranceSubmissions });
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
      return json(201, { success: true, assetUrl: `${origin}/logo.png` });
    }
    if (url.pathname.startsWith("/api/rbac/") || url.pathname.startsWith("/api/access/")) {
      return json(200, { success: true, users, posts });
    }
    return route.continue();
  });

  return {
    getWorkspaceState: () => workspaceState
  };
}

const browser = await chromium.launch({
  headless: true,
  timeout: 30000,
  ...(process.platform === "win32" ? { channel: "msedge" } : {})
});
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
const failedResponses = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400) {
    failedResponses.push(`${response.request().method()} ${response.status()} ${response.url()}`);
  }
});

let smokePassed = false;
try {
  const moduleKeys = await safeModuleSweep(page);
  console.log("[smoke] module sweep complete");
  await runWorkflow(page);
  console.log("[smoke] linked workflow complete");
  await submitRemainingForms(page);
  console.log("[smoke] all form paths submitted");
  await refreshCoverage(page, moduleKeys);
  await verifyDurableReload(page, localSmokeApi);
  console.log("[smoke] durable reload verified");
  await refreshCoverage(page, moduleKeys);
  await exerciseRemainingActions(page);
  console.log("[smoke] action matrix complete");
  await testUnauthenticatedGate(browser);
  await testEmployeePortal(browser);
  const allowedInteractiveActions = new Set(["firebase-google-login"]);
  const unexercisedActionTypes = staticActionTypes
    .filter((action) => !actionCoverage.exercised.has(action) && !allowedInteractiveActions.has(action));
  const unsubmittedFormTypes = staticFormTypes
    .filter((formType) => !actionCoverage.formsSubmitted.has(formType));
  results.actionTypesExercised = actionCoverage.exercised.size;
  results.formTypesSubmitted = actionCoverage.formsSubmitted.size;
  results.coverage = {
    expectedActionTypes: staticActionTypes,
    expectedFormTypes: staticFormTypes,
    renderedActionTypes: [...actionCoverage.rendered].sort(),
    exercisedActionTypes: [...actionCoverage.exercised].sort(),
    renderedFormTypes: [...actionCoverage.formsRendered].sort(),
    submittedFormTypes: [...actionCoverage.formsSubmitted].sort(),
    interactiveProviderBoundaries: [...allowedInteractiveActions],
    unexercisedActionTypes,
    unsubmittedFormTypes
  };
  if (unexercisedActionTypes.length) {
    throw new Error(`Action types not exercised: ${unexercisedActionTypes.join(", ")}`);
  }
  if (unsubmittedFormTypes.length) {
    throw new Error(`Form types not submitted: ${unsubmittedFormTypes.join(", ")}`);
  }
  if (consoleErrors.length || failedResponses.length) {
    throw new Error(`Browser errors during smoke: ${[...new Set([...consoleErrors, ...failedResponses])].join(" | ")}`);
  }
  await new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify({ ok: true, ...results }, null, 2)}\n`, resolve);
  });
  smokePassed = true;
} catch (error) {
  const diagnostics = await page.evaluate(() => ({
    url: location.href,
    heading: document.querySelector("h1")?.textContent?.trim() || "",
    body: document.body.innerText.slice(0, 1200),
    forms: [...document.querySelectorAll("form[data-form]")].map((form) => form.dataset.form)
  })).catch(() => ({}));
  console.error(JSON.stringify({ diagnostics }, null, 2));
  throw error;
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (smokePassed) process.exit(0);
}
