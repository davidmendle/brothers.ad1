import { chromium } from "playwright";

const baseUrl = process.env.BROTHERS_OS_BASE_URL || "http://127.0.0.1:4198";
const origin = new URL(baseUrl).origin;
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
  dryRoom: `Kitchen ${stamp}`,
  photoRef: `IMG-AI-${stamp}.jpg`,
  equipmentName: `AI Dehumidifier ${stamp}`,
  assetTag: `DH-AI-${stamp}`
};

const results = {
  baseUrl,
  ids,
  modulesChecked: 0,
  buttonsChecked: 0,
  formsChecked: 0,
  workflowChecks: []
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
  await page.goto(moduleUrl(key), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 8000 });
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
  await (await unique(page.locator(selector), selector)).click();
}

async function clickAny(page, selector, label) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (!count) throw new Error(`${label || selector} matched 0 elements`);
  await locator.first().click();
}

async function expectBody(page, label, text) {
  await page.waitForFunction((needle) => document.body.textContent.includes(needle), text, { timeout: 8000 });
  results.workflowChecks.push({ label, text });
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
    const summary = await page.evaluate(() => ({
      buttons: document.querySelectorAll("button").length,
      forms: document.querySelectorAll("form[data-form]").length,
      inertButtons: [...document.querySelectorAll("button")]
        .filter((button) => !button.disabled && !button.dataset.action && !button.closest("form"))
        .map((button) => button.textContent.trim().replace(/\s+/g, " "))
        .filter(Boolean)
    }));
    if (summary.inertButtons.length) {
      throw new Error(`Module ${key} rendered inert buttons: ${summary.inertButtons.join(", ")}`);
    }
    results.modulesChecked += 1;
    results.buttonsChecked += summary.buttons;
    results.formsChecked += summary.forms;
  }
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
  await expectBody(page, "team shows portal code", ids.accessCode);
  await expectBody(page, "team shows assigned task", ids.taskTitle);

  await click(page, 'button[data-action="open-employee-login"]');
  await fill(page, 'form[data-form="employee-login"] input[name="identifier"]', ids.employeeEmail);
  await fill(page, 'form[data-form="employee-login"] input[name="code"]', ids.accessCode);
  await click(page, 'form[data-form="employee-login"] button[type="submit"]');
  await expectBody(page, "employee portal opened", "Field worker portal");
  await page.goto(moduleUrl("globalindexes"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".app-shell", { timeout: 8000 });
  const employeeGlobalView = await page.locator("h1").textContent();
  if (/Global Indexes/i.test(employeeGlobalView || "")) {
    throw new Error("Employee portal can open global indexes");
  }
  await clickAny(page, 'button[data-action="employee-logout"]', "employee logout");

  await go(page, "communications");
  await expectBody(page, "unauthenticated board posting restricted", "Posting restricted");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  geolocation: { latitude: 42.45, longitude: -73.245 },
  permissions: ["geolocation"]
});
await context.grantPermissions(["geolocation"], { origin });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await safeModuleSweep(page);
  await runWorkflow(page);
  if (consoleErrors.length) {
    throw new Error(`Console errors during smoke: ${consoleErrors.join(" | ")}`);
  }
  console.log(JSON.stringify({ ok: true, ...results }, null, 2));
} finally {
  await browser.close();
}
