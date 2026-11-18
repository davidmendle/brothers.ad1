import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { parsePricingImport } from "../pricing-import.js";

const execFileAsync = promisify(execFile);

async function cleanupDeadline(operation, label, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout); })
    ]);
  } finally { clearTimeout(timer); }
}

async function closeOwnedBrowser(browser, browserServer) {
  if (!browserServer) return;
  const child = browserServer.process();
  const running = () => child.exitCode === null && child.signalCode === null;
  const exited = running() ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
  // Disconnect the client before stopping its server to release open transports.
  try { await cleanupDeadline(browser?.close(), "Browser client disconnect"); }
  catch (error) { console.warn(error.message); }
  try { await cleanupDeadline(browserServer.close(), "Browser server shutdown"); }
  catch {
    if (running()) {
      if (process.platform === "win32") {
        try {
          await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 });
        } catch (error) {
          // A descendant may exit between taskkill's process-tree scan and termination.
          // Finish Playwright cleanup even when taskkill reports an exit race.
          console.warn(`taskkill exit race: ${error.message}`);
        }
      } else child.kill("SIGKILL");
    }
    await cleanupDeadline(browserServer.kill(), "Owned browser process cleanup");
  }
  await cleanupDeadline(exited, `Test browser ${child.pid} exit`);
  if (running()) throw new Error(`Test browser ${child.pid} survived cleanup`);
}

const header = "Code,Description,Unit,Quantity,Unit Price";
const row = "WTR.LAB,Water mitigation technician,HR,0.5,85.25";
const parseCsv = (text, options = {}) => parsePricingImport(text, { fileName: "prices.csv", ...options });

describe("pricing CSV and TSV imports", () => {
  it("imports explicit fields without changing quantities or amounts", () => {
    const result = parseCsv(`${header}\n${row}`);
    expect(result).toMatchObject({ status: "ready", format: "csv", skippedRows: 0, issues: [] });
    expect(result.lines).toEqual([{ code: "WTR.LAB", name: "Water mitigation technician", unit: "hr", qty: 0.5, rate: 85.25, source: "prices.csv" }]);
  });

  it("handles BOM, CRLF, escaped quotes, commas, and multiline descriptions", () => {
    const result = parseCsv('\uFEFFCode,Description,Unit,Quantity,Unit Price\r\nDRY.12,"Drywall, 1/2""\r\nIncluding finish",SF,2,"$1,234.56"\r\n');
    expect(result.status).toBe("ready");
    expect(result.lines[0]).toMatchObject({ code: "DRY.12", name: 'Drywall, 1/2"\nIncluding finish', unit: "sf", qty: 2, rate: 1234.56 });
  });

  it("combines CAT and SEL and retains price-book metadata", () => {
    const result = parseCsv('CAT,SEL,Description,UOM,Qty,Unit Price,Cost,Market,Notes\nWTR,LAB,Technician,HR,2,85,40,Test Market,"Source, only"');
    expect(result.lines[0]).toMatchObject({ code: "WTR.LAB", category: "WTR", cost: 40, branch: "Test Market", justification: "Source, only" });
  });

  it("uses explicit combined codes without duplicating the category", () => {
    expect(parseCsv('Cat/Sel,Cat,Sel,Description,Unit,Rate\nWTR.LAB,WTR,LAB,Technician,HR,85').lines[0].code).toBe("WTR.LAB");
  });

  it.each(["Unit Price", "Unit Rate", "Unit Cost", "Price per unit", "Rate", "Price"])("recognizes the %s header", (column) => {
    expect(parseCsv(`Description,UOM,${column}\nTechnician,HR,85`).lines[0]).toMatchObject({ code: "", qty: 1, rate: 85 });
  });

  it.each(["RCV", "Amount", "Total", "Cost", "Labor Cost", "Material Cost"])("does not turn %s into a unit selling price", (column) => {
    const result = parseCsv(`Description,Unit,Quantity,${column}\nTechnician,HR,10,850`);
    expect(result.status).toBe("rejected");
    expect(result.lines).toEqual([]);
    expect(result.issues[0].code).toBe("missing-headers");
  });

  it("ignores totals when an explicit unit price exists", () => {
    expect(parseCsv('Description,Unit,Quantity,Unit Price,RCV,Amount,Total\nTechnician,HR,10,85,1000,900,850').lines[0].rate).toBe(85);
  });

  it("preserves zero quantities, zero rates, fractional quantities, and credits", () => {
    const result = parseCsv(`${header}\nA,Free item,EA,0,0\nB,Credit,EA,-1,5.125\nC,Credit rate,EA,0.25,($12.50)`);
    expect(result.lines.map(({ qty, rate }) => [qty, rate])).toEqual([[0, 0], [-1, 5.125], [0.25, -12.5]]);
  });

  it.each([["$1,250.50", 1250.5], ["USD 1,250.50", 1250.5], ["US$1,250.50", 1250.5], ["1,250.50 USD", 1250.5], ["-$12.50", -12.5], ["$-12.50", -12.5], ["($12.50)", -12.5], [".25", 0.25]])("parses an unambiguous USD amount %s", (amount, expected) => {
    expect(parseCsv(`${header}\nA,Item,EA,1,"${amount}"`).lines[0].rate).toBe(expected);
  });

  it.each(["1,23", "1.234,56", "1,234,56", "85abc", "Infinity", "NaN", "1e3", "=SUM(1)", "", "1 234", "--1", "9007199254740992"])("rejects malformed or ambiguous amounts: %s", (amount) => {
    const result = parseCsv(`${header}\nA,Item,EA,1,"${amount}"`);
    expect(result.status).toBe("rejected");
    expect(result.issues[0]).toMatchObject({ code: "invalid-line", row: 2 });
  });

  it("reports partial imports and physical row numbers after multiline fields", () => {
    const result = parseCsv(`${header}\nA,"First\nline",EA,1,10\nB,Invalid quantity,EA,bad,20\nC,Last line,EA,2,30`);
    expect(result).toMatchObject({ status: "partial", skippedRows: 1 });
    expect(result.lines).toHaveLength(2);
    expect(result.issues[0].row).toBe(4);
  });

  it("does not silently remove identical lines or change their quantities", () => {
    const result = parseCsv(`${header}\n${row}\n${row}\nWTR.LAB,Water mitigation technician,HR,3,85.25`);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.reduce((sum, line) => sum + line.qty * line.rate, 0)).toBe(341);
  });

  it("does not infer columns from a headerless CSV", () => {
    expect(parseCsv(row)).toMatchObject({ status: "rejected", lines: [] });
  });

  it("does not infer missing units, quantities, or invalid costs", () => {
    expect(parseCsv("Description,Rate\nItem,12").issues[0].code).toBe("missing-unit-header");
    expect(parseCsv(`${header}\nA,Item,,1,12`).status).toBe("rejected");
    expect(parseCsv(`${header}\nA,Item,EA,,12`).status).toBe("rejected");
    expect(parseCsv(`${header},Cost\nA,Item,EA,1,12,bad`).issues[0].code).toBe("invalid-cost");
  });

  it("rejects ambiguous aliases instead of choosing a possibly different price", () => {
    expect(parseCsv("Description,Unit,Rate,Unit Price\nItem,EA,10,20").issues[0].code).toBe("ambiguous-headers");
    expect(parseCsv("Description,Unit,Rate,Rate\nItem,EA,10,20").status).toBe("rejected");
  });

  it("reports summary/preamble and repeated headers rather than importing them", () => {
    const result = parseCsv(`Estimate: Test\n${header}\n${row}\n${header}\nTotal,,,,85.25`);
    expect(result.lines).toHaveLength(1);
    expect(result).toMatchObject({ status: "partial", skippedRows: 3 });
    expect(result.issues.map((item) => item.code)).toEqual(["skipped-preamble", "repeated-header", "invalid-line"]);
  });

  it.each(['A,"Unclosed,EA,1,12', 'A,"Closed"oops,EA,1,12', 'A,Unquoted"quote,EA,1,12'])("rejects malformed CSV syntax atomically: %s", (badRow) => {
    expect(parseCsv(`${header}\n${row}\n${badRow}`)).toMatchObject({ status: "rejected", lines: [], issues: [{ code: "invalid-csv" }] });
  });

  it("skips misaligned columns instead of importing an unquoted currency comma", () => {
    const result = parseCsv(`${header}\nA,Item,EA,1,$1,234.56`);
    expect(result.lines).toEqual([]);
    expect(result.issues[0].code).toBe("column-count");
  });

  it("detects tab and semicolon exports without mistaking punctuation in descriptions", () => {
    expect(parsePricingImport("Description\tUnit\tUnit Price\nItem\tEA\t12").format).toBe("tsv");
    expect(parseCsv("Description;Unit;Unit Price\nItem;EA;12").lines[0].rate).toBe(12);
    expect(parseCsv('Description,Unit,Unit Price\n"Item; with tab\tand semicolon",EA,12').lines[0].rate).toBe(12);
    expect(parseCsv("sep=;\r\nDescription;Unit;Unit Price\r\nItem;EA;12").status).toBe("ready");
  });

  it("keeps formula-looking descriptions as plain inert strings", () => {
    expect(parseCsv('Description,Unit,Unit Price\n"=HYPERLINK(\"\"https://example.test\"\")",EA,12').lines[0].name).toBe('=HYPERLINK("https://example.test")');
  });
});

describe("pricing text imports and file boundaries", () => {
  it("parses the existing sample and signed, grouped, and fractional values", () => {
    const result = parsePricingImport("WTR.LAB Water mitigation technician labor 4 HR 85.00\nEQP.DEH Commercial dehumidifier rental 3 DAYS 95.00\nDOC.PKT Photo and invoice support packet 1 EACH 185.00\n1. DRY 12 Drywall 0.5 SF $1,250.50");
    expect(result.status).toBe("ready");
    expect(result.lines).toHaveLength(4);
    expect(result.lines[3]).toMatchObject({ code: "DRY.12", qty: 0.5, rate: 1250.5 });
  });

  it("does not accept multi-column financial report text as a guessed unit rate", () => {
    expect(parsePricingImport("WTR.LAB Technician 1 HR 85.00 5.00 90.00").lines).toEqual([]);
  });

  it.each(["Hello world", "<notXML>", "RCV total 1,234.50", "Code Description", "xactimate.pdf text only"])("does not invent rows from arbitrary text: %s", (text) => {
    expect(parsePricingImport(text, { fileName: "xactimate import" }).lines).toEqual([]);
  });

  it.each(["esx", "pdf", "zip", "xlsx", "xls", "xlsm", "xlsb", "xlp"])("rejects a .%s filename even when the caller passes apparent text", (extension) => {
    const result = parsePricingImport(`${header}\n${row}`, { fileName: `ESTIMATE.${extension.toUpperCase()}` });
    expect(result).toMatchObject({ status: "rejected", format: "unsupported", lines: [] });
    expect(result.issues[0].code).toBe("unsupported-file");
  });

  it.each(["PK\u0003\u0004", "%PDF-1.7", "bad\u0000data", "bad\uFFFDdata", "\u00D0\u00CF\u0011\u00E0"])("rejects binary content despite a CSV filename: %s", (text) => {
    expect(parseCsv(text).issues[0].code).toBe("binary-content");
  });

  it("rejects empty and non-text inputs", () => {
    expect(parsePricingImport("  \n").issues[0].code).toBe("empty-file");
    expect(parsePricingImport(new Uint8Array([1, 2])).issues[0].code).toBe("text-required");
  });

  it("bounds character and row counts without returning truncated success", () => {
    expect(parseCsv(`${header}\n${row}`, { maxCharacters: 5 }).issues[0].code).toBe("size-limit");
    expect(parseCsv(`${header}\n${row}\n${row}`, { maxRows: 1 })).toMatchObject({ status: "rejected", lines: [] });
    expect(parsePricingImport("WTR.LAB Labor 1 HR 85\nWTR.LAB Labor 1 HR 85", { maxRows: 1 }).issues[0].code).toBe("row-limit");
    expect(parseCsv(row, { maxRows: 0 }).issues[0].code).toBe("invalid-limits");
  });

  it("returns a clear diagnostic when DOMParser is unavailable", () => {
    expect(parsePricingImport("<estimate/>", { DOMParser: null }).issues[0].code).toBe("xml-parser-unavailable");
  });

  it("accepts already-extracted documents with explicit formats and preserves provenance", () => {
    expect(parsePricingImport("WTR.LAB Labor 0.5 HR 85", { fileName: "estimate.pdf", format: "text" }).lines[0])
      .toMatchObject({ source: "estimate.pdf", qty: 0.5, rate: 85 });
    expect(parsePricingImport(`${header}\n${row}`, { fileName: "estimate.esx/report.csv", format: "csv" }).lines[0].source).toBe("estimate.esx/report.csv");
    expect(parsePricingImport("Description\tUnit\tRate\nLabor\tHR\t85", { fileName: "sheet.xlsx", format: "tsv" }).lines[0].rate).toBe(85);
  });

  it("does not let an explicit format bypass binary detection", () => {
    expect(parsePricingImport("%PDF-1.7", { fileName: "estimate.pdf", format: "text" }).issues[0].code).toBe("binary-content");
    expect(parsePricingImport(row, { format: "pdf" }).issues[0].code).toBe("unsupported-format");
  });

  it("lets an explicit format override the filename and keeps directive row numbers accurate", () => {
    expect(parsePricingImport(`${header}\n${row}`, { fileName: "extracted.tsv", format: "csv" }).status).toBe("ready");
    expect(parseCsv("sep=;\nDescription;Unit;Unit Price\nInvalid;EA;bad").issues[0].row).toBe(3);
  });
});

describe("XML pricing in a real browser DOMParser", () => {
  let browser, browserServer, page;
  beforeAll(async () => {
    const options = { headless: true };
    try { browserServer = await chromium.launchServer(options); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      browserServer = await chromium.launchServer({ ...options, channel: "msedge" });
    }
    browser = await chromium.connect(browserServer.wsEndpoint());
    page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    const source = await readFile(new URL("../pricing-import.js", import.meta.url), "utf8");
    await page.addScriptTag({ type: "module", content: `${source}\nglobalThis.parsePricingImport = parsePricingImport;` });
    await page.waitForFunction(() => typeof globalThis.parsePricingImport === "function");
  }, 60000);
  afterAll(async () => { await closeOwnedBrowser(browser, browserServer); }, 45000);

  const parseXml = (text, options = {}) => page.evaluate(({ text, options }) => globalThis.parsePricingImport(text, { fileName: "prices.xml", ...options }), { text, options });

  it("supports attribute fields, case variations, escaped text, and separate CAT/SEL", async () => {
    const result = await parseXml('<Estimate><LineItem CAT="WTR" SEL="LAB" DESCRIPTION="Clean &amp; dry" UOM="HR" QUANTITY="0.5" UNITPRICE="$85.25" /></Estimate>');
    expect(result).toMatchObject({ status: "ready", format: "xml" });
    expect(result.lines[0]).toMatchObject({ code: "WTR.LAB", name: "Clean & dry", unit: "hr", qty: 0.5, rate: 85.25 });
  });

  it("supports namespaced direct child fields and the root record itself", async () => {
    const result = await parseXml('<p:LineItem xmlns:p="urn:test"><p:Code>WTR.LAB</p:Code><p:Description>Labor</p:Description><p:Unit>HR</p:Unit><p:Qty>2</p:Qty><p:UnitPrice>85</p:UnitPrice></p:LineItem>');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ code: "WTR.LAB", qty: 2, rate: 85 });
  });

  it("preserves repeated items and zero or negative values", async () => {
    const item = '<item code="A" description="Credit" unit="EA" quantity="0" unitPrice="-5" />';
    expect((await parseXml(`<estimate>${item}${item}</estimate>`)).lines).toHaveLength(2);
    expect((await parseXml(item)).lines[0]).toMatchObject({ qty: 0, rate: -5 });
  });

  it("does not read a nested component price as the parent selling rate", async () => {
    const result = await parseXml('<estimate><item description="Labor" unit="HR"><component><unitPrice>85</unitPrice></component></item></estimate>');
    expect(result.status).toBe("rejected");
    expect(result.lines).toEqual([]);
  });

  it("rejects totals without a unit rate", async () => {
    expect((await parseXml('<item description="Labor" unit="HR" qty="10" rcv="850" amount="850"/>')).lines).toEqual([]);
  });

  it("rejects conflicting fields but accepts a matching attribute/child pair", async () => {
    expect((await parseXml('<item description="Labor" unit="HR" unitPrice="85"><rate>90</rate></item>')).issues[0].code).toBe("ambiguous-xml-fields");
    expect((await parseXml('<item description="Labor" unit="HR" unitPrice="85"><unitPrice>85</unitPrice></item>')).status).toBe("ready");
  });

  it("rejects malformed XML atomically even if an earlier record is readable", async () => {
    const result = await parseXml('<estimate><item description="Labor" unit="HR" unitPrice="85"/><item></estimate>');
    expect(result).toMatchObject({ status: "rejected", lines: [] });
    expect(result.issues[0].code).toBe("invalid-xml");
  });

  it.each(['<!DOCTYPE estimate SYSTEM "https://example.test/external.dtd"><estimate/>', '<!DOCTYPE estimate [<!ENTITY secret SYSTEM "file:///private">]><estimate/>'])("rejects DTD/entity declarations without fetching anything", async (text) => {
    expect((await parseXml(text)).issues[0].code).toBe("unsafe-xml");
  });

  it("rejects unsupported schemas without guessing record content", async () => {
    expect((await parseXml('<estimate><amount>100</amount><name>Test</name></estimate>')).issues[0].code).toBe("no-pricing-lines");
  });

  it("enforces XML row limits", async () => {
    const item = '<item description="Labor" unit="HR" unitPrice="85"/>';
    expect((await parseXml(`<estimate>${item}${item}</estimate>`, { maxRows: 1 })).issues[0].code).toBe("row-limit");
  });
});
