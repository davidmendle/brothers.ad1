import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import * as fflate from "fflate";
import { extractPricingDocuments } from "../import-files.js";

const MiB = 1024 * 1024;
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
  // Disconnect the client before stopping its server; otherwise open transports
  // can keep Windows browser-server shutdown waiting indefinitely.
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
const encoder = new TextEncoder();
const pricingCsv = "Code,Description,Unit,Quantity,Unit Price\nWTR.LAB,Technician,HR,0.5,85.25";
const input = (name, data) => {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const extract = (name, data, dependencies = {}) => extractPricingDocuments(input(name, data), { fflate, ...dependencies });
const concat = (parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};

function streamingZip(files) {
  const chunks = [];
  let finished = false;
  const zip = new fflate.Zip((error, chunk, final) => {
    if (error) throw error;
    chunks.push(chunk);
    finished = final;
  });
  for (const [name, bytes] of Object.entries(files)) {
    const entry = new fflate.ZipDeflate(name, { level: 6 });
    zip.add(entry);
    const midpoint = Math.floor(bytes.length / 2);
    entry.push(bytes.subarray(0, midpoint), false);
    entry.push(bytes.subarray(midpoint), true);
  }
  zip.end();
  if (!finished) throw new Error("Fixture ZIP did not finish.");
  return concat(chunks);
}

function pdfDouble({ text = "WTR.LAB Technician 0.5 HR 85.25", numPages = 1, pending = false, pageError = null } = {}) {
  const cleanup = vi.fn();
  const page = { cleanup, getTextContent: vi.fn(async () => {
    if (pageError) throw pageError;
    return { items: [{ str: text, transform: [1, 0, 0, 1, 40, 700] }] };
  }) };
  const pdf = { numPages, getPage: vi.fn(async () => page) };
  const loading = { promise: pending ? new Promise(() => {}) : Promise.resolve(pdf), destroy: vi.fn(async () => {}) };
  return { pdfjs: { GlobalWorkerOptions: {}, getDocument: vi.fn(() => loading) }, loading, pdf, page, cleanup };
}

// This is a real PDF with cross-reference offsets, Helvetica text operators, and
// Flate-compressed page streams. The fixtures contain no user records.
function makePdf(streams = ["BT /F1 12 Tf 40 700 Td (WTR.LAB Technician 0.5 HR 85.25) Tj ET"]) {
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${streams.length} >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  ];
  streams.forEach((stream, index) => {
    const compressed = deflateSync(Buffer.from(stream, "ascii"));
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`), compressed, Buffer.from("\nendstream")]));
  });
  const pieces = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let length = pieces[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const piece = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    pieces.push(piece);
    length += piece.length;
  });
  pieces.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(pieces));
}

describe("pricing document extraction", () => {
  afterEach(() => vi.useRealTimers());

  it.each([0, 6])("extracts a real ZIP using compression level %s", async (level) => {
    const zip = fflate.zipSync({ "items.csv": encoder.encode(pricingCsv), "photo.jpg": new Uint8Array([0, 1, 2]), "folder/": new Uint8Array() }, { level });
    expect(await extract("test.esx", zip)).toEqual([{ name: "test.esx/items.csv", text: pricingCsv, format: "csv" }]);
  });

  it("reads real streaming ZIP data descriptors and multiple compressed entries", async () => {
    const zip = streamingZip({ "items.csv": encoder.encode(pricingCsv), "notes.txt": encoder.encode("WTR.LAB Technician 0.5 HR 85.25") });
    expect(new DataView(zip.buffer).getUint16(6, true) & 8).toBe(8);
    expect(new DataView(zip.buffer).getUint32(18, true)).toBe(0);
    expect(Buffer.from(zip).includes(Buffer.from([0x50, 0x4b, 0x07, 0x08]))).toBe(true);
    const documents = await extract("streamed.esx", zip);
    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual({ name: "streamed.esx/items.csv", text: pricingCsv, format: "csv" });
  });

  it("retains separate document boundaries and provenance in nested archives", async () => {
    const nested = streamingZip({ "line-items.xml": encoder.encode('<items><item description="Labor" unit="HR" unitPrice="85"/></items>') });
    const outer = fflate.zipSync({ "nested.esx": nested, "items.csv": encoder.encode(pricingCsv) });
    const documents = await extract("outer.esx", outer);
    expect(documents.map(({ name, format }) => ({ name, format }))).toEqual([
      { name: "outer.esx/nested.esx/line-items.xml", format: "xml" },
      { name: "outer.esx/items.csv", format: "csv" }
    ]);
  });

  it("rejects excessive archive nesting", async () => {
    let bytes = encoder.encode(pricingCsv);
    for (let depth = 0; depth < 4; depth += 1) bytes = fflate.zipSync({ [depth ? "nested.esx" : "items.csv"]: bytes });
    await expect(extract("outer.esx", bytes)).rejects.toThrow(/nested/);
  });

  it("rejects more than 1000 archive entries, including ignored binary attachments", async () => {
    const files = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`${index}.jpg`, new Uint8Array()]));
    await expect(extract("many.esx", fflate.zipSync(files))).rejects.toThrow(/too many files/);
  });

  it("rejects empty, oversized, unsupported, and malformed top-level inputs", async () => {
    await expect(extract("empty.csv", "")).rejects.toThrow(/non-empty/);
    await expect(extractPricingDocuments({ name: "big.csv", size: 26 * MiB, arrayBuffer: vi.fn() })).rejects.toThrow(/25 MB/);
    await expect(extract("sheet.xlsx", "not a workbook")).rejects.toThrow(/Choose/);
    await expect(extract("bad.esx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).rejects.toThrow();
  });

  it("verifies actual file length rather than trusting an inaccurate size field", async () => {
    await expect(extractPricingDocuments({ name: "file.csv", size: 1, arrayBuffer: async () => new ArrayBuffer(26 * MiB) })).rejects.toThrow(/25 MB|size/);
  });

  it.each(["bad\u0000data", "bad\u000bdata", "bad\u000cdata", "bad\u001fdata"])("rejects binary controls in decoded text", async (text) => {
    await expect(extract("binary.csv", text)).rejects.toThrow(/binary/);
  });

  it("rejects mislabelled non-PDF and non-archive files", async () => {
    await expect(extract("wrong.pdf", pricingCsv)).rejects.toThrow(/PDF/);
    await expect(extract("wrong.esx", pricingCsv)).rejects.toThrow(/ESX|archive|package/);
  });

  it("decodes UTF-8 BOM, UTF-16 LE/BE, and Windows-1252 text", async () => {
    expect((await extract("bom.csv", "\uFEFF" + pricingCsv))[0].text).toBe(pricingCsv);
    const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(pricingCsv, "utf16le")]);
    const bigBody = Buffer.from(pricingCsv, "utf16le");
    bigBody.swap16();
    const big = Buffer.concat([Buffer.from([0xfe, 0xff]), bigBody]);
    expect((await extract("utf16.csv", little))[0].text).toBe(pricingCsv);
    expect((await extract("utf16.csv", big))[0].text).toBe(pricingCsv);
    expect((await extract("legacy.txt", new Uint8Array([0x43, 0x61, 0x66, 0xe9])))[0].text).toBe("Caf\u00e9");
  });

  it("supports TSV exports and rejects whitespace-only files", async () => {
    expect((await extract("items.tsv", "Description\tUnit\tRate\nLabor\tHR\t85"))[0].format).toBe("tsv");
    await expect(extract("empty.txt", " \r\n\t ")).rejects.toThrow(/No readable/);
  });

  it("rejects archives without readable documents", async () => {
    await expect(extract("photos.esx", fflate.zipSync({ "photo.jpg": new Uint8Array([1, 2]) }))).rejects.toThrow(/No readable/);
  });

  it("rejects an overlarge real compressed member before decompression", async () => {
    const zip = fflate.zipSync({ "too-big.txt": new Uint8Array(26 * MiB) });
    await expect(extract("large.esx", zip)).rejects.toThrow(/size limit/);
  });

  it("enforces aggregate expanded sizes across real nested archives", async () => {
    const padding = new Uint8Array(21 * MiB).fill(32);
    padding.set(encoder.encode("%PDF-1.7"));
    const nested = fflate.zipSync({ "report.pdf": padding });
    const outer = fflate.zipSync({ "one.esx": nested, "two.esx": nested });
    await expect(extract("nested.esx", outer, { pdfjs: pdfDouble().pdfjs })).rejects.toThrow(/size limit/);
  }, 15000);

  it("rejects mismatched output sizes from an unpacker", async () => {
    const fake = { unzip(bytes, { filter }, callback) {
      filter({ name: "data.txt", originalSize: 1 });
      callback(null, { "data.txt": encoder.encode("unreported bytes") });
      return vi.fn();
    } };
    await expect(extract("mismatch.esx", new Uint8Array([0x50, 0x4b]), { fflate: fake })).rejects.toThrow(/size/);
  });

  it("bounds total decoded text across separate archive members", async () => {
    const bytes = new Uint8Array(3 * MiB).fill(65);
    await expect(extract("large.esx", fflate.zipSync({ "one.txt": bytes, "two.txt": bytes }))).rejects.toThrow(/too much text/);
  }, 15000);

  it("terminates an archive worker that never completes", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const promise = extract("stalled.esx", new Uint8Array([0x50, 0x4b]), { fflate: { unzip: () => terminate } });
    const rejected = expect(promise).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("terminates exactly once on a filter rejection even with a later callback", async () => {
    const terminate = vi.fn();
    const fake = { unzip(bytes, { filter }, callback) {
      filter({ name: "oversize.txt", originalSize: 26 * MiB });
      queueMicrotask(() => callback(null, {}));
      return terminate;
    } };
    await expect(extract("large.esx", new Uint8Array([0x50, 0x4b]), { fflate: fake })).rejects.toThrow(/size limit/);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("rejects duplicate member names instead of silently losing a document", async () => {
    const chunks = [];
    const zip = new fflate.Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
    for (let index = 0; index < 2; index += 1) {
      const entry = new fflate.ZipDeflate("items.csv");
      zip.add(entry);
      entry.push(encoder.encode(pricingCsv), true);
    }
    zip.end();
    await expect(extract("duplicates.esx", concat(chunks))).rejects.toThrow(/duplicate/);
  });

  it("rejects PDF page limits and always destroys the loading task", async () => {
    const test = pdfDouble({ numPages: 201 });
    await expect(extract("huge.pdf", encoder.encode("%PDF-1.7"), { pdfjs: test.pdfjs })).rejects.toThrow(/200 pages/);
    expect(test.loading.destroy).toHaveBeenCalled();
    expect(test.pdf.getPage).not.toHaveBeenCalled();
  });

  it("cleans up PDF pages after extraction errors", async () => {
    const test = pdfDouble({ pageError: new Error("fixture text extraction failed") });
    await expect(extract("error.pdf", encoder.encode("%PDF-1.7"), { pdfjs: test.pdfjs })).rejects.toThrow(/fixture/);
    expect(test.cleanup).toHaveBeenCalledOnce();
    expect(test.loading.destroy).toHaveBeenCalled();
  });

  it("rejects a stuck PDF independently of worker cleanup behavior", async () => {
    vi.useFakeTimers();
    const test = pdfDouble({ pending: true });
    const promise = extract("pending.pdf", encoder.encode("%PDF-1.7"), { pdfjs: test.pdfjs });
    const rejected = expect(promise).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(45001);
    await rejected;
    expect(test.loading.destroy).toHaveBeenCalled();
  });

  it("does not allow stuck PDF cleanup to defeat the extraction deadline", async () => {
    vi.useFakeTimers();
    const test = pdfDouble({ pending: true });
    test.loading.destroy.mockImplementation(() => new Promise(() => {}));
    const promise = extract("pending.pdf", encoder.encode("%PDF-1.7"), { pdfjs: test.pdfjs });
    const rejected = expect(promise).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(45001);
    await rejected;
    expect(test.loading.destroy).toHaveBeenCalledOnce();
  });
});

describe("real browser pdfjs and fflate extraction", () => {
  let browser, browserServer, page, server, origin;
  const requests = [];
  beforeAll(async () => {
    const paths = new Map([
      ["/import-files.js", "../import-files.js"],
      ["/vendor/fflate.mjs", "../node_modules/fflate/esm/browser.js"],
      ["/vendor/pdf.mjs", "../node_modules/pdfjs-dist/build/pdf.mjs"],
      ["/vendor/pdf.worker.mjs", "../node_modules/pdfjs-dist/build/pdf.worker.mjs"]
    ]);
    const assets = new Map(await Promise.all(Array.from(paths, async ([route, file]) => [route, await readFile(new URL(file, import.meta.url))])));
    server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<!doctype html><title>Local extractor fixture</title><script type="module">import { extractPricingDocuments } from "/import-files.js"; globalThis.extractPricingDocuments = extractPricingDocuments;</script>');
      } else if (assets.has(request.url)) {
        response.writeHead(200, { "Content-Type": "text/javascript" });
        response.end(assets.get(request.url));
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    try { browserServer = await chromium.launchServer({ headless: true }); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      browserServer = await chromium.launchServer({ headless: true, channel: "msedge" });
    }
    browser = await chromium.connect(browserServer.wsEndpoint());
    page = await browser.newPage();
    await page.route("**/*", (route) => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
    await page.goto(origin);
    await page.waitForFunction(() => typeof globalThis.extractPricingDocuments === "function");
  }, 60000);
  afterAll(async () => {
    // Start HTTP cleanup independently so a browser failure cannot strand it.
    const httpCleanup = server ? new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      }) : Promise.resolve();
    const outcomes = await Promise.allSettled([
      closeOwnedBrowser(browser, browserServer),
      cleanupDeadline(httpCleanup, "Fixture HTTP server shutdown")
    ]);
    const failures = outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason);
    if (failures.length) throw new AggregateError(failures, "Import fixture cleanup failed");
  }, 45000);

  const browserExtract = (name, bytes) => page.evaluate(async ({ name, bytes }) => {
    try { return { documents: await globalThis.extractPricingDocuments(new File([new Uint8Array(bytes)], name)) }; }
    catch (error) { return { error: error.message }; }
  }, { name, bytes: Array.from(bytes) });

  it("extracts selectable text from actual Flate-compressed PDF streams", async () => {
    const pdf = makePdf();
    expect(Buffer.from(pdf).includes(Buffer.from("/FlateDecode"))).toBe(true);
    expect(Buffer.from(pdf).includes(Buffer.from("WTR.LAB"))).toBe(false);
    const result = await browserExtract("compressed-report.pdf", pdf);
    expect(result.error).toBeUndefined();
    expect(result.documents).toEqual([{ name: "compressed-report.pdf", text: "WTR.LAB Technician 0.5 HR 85.25", format: "text" }]);
    expect(requests).toContain("/vendor/pdf.mjs");
    expect(requests).toContain("/vendor/pdf.worker.mjs");
  }, 30000);

  it("orders positioned text into lines and preserves page order", async () => {
    const pdf = makePdf([
      "BT /F1 12 Tf 40 600 Td (Second row) Tj ET\nBT /F1 12 Tf 180 700 Td (Technician) Tj ET\nBT /F1 12 Tf 40 700 Td (WTR.LAB) Tj ET",
      "BT /F1 12 Tf 40 700 Td (Third row) Tj ET"
    ]);
    const result = await browserExtract("positions.pdf", pdf);
    expect(result.documents?.[0].text).toBe("WTR.LAB Technician\nSecond row\nThird row");
  }, 30000);

  it("rejects a real PDF with no selectable text rather than claiming success", async () => {
    const result = await browserExtract("no-text.pdf", makePdf(["q 0 0 200 100 re f Q"]));
    expect(result.error).toMatch(/no selectable text/);
  }, 30000);

  it("extracts a compressed PDF inside a real streamed ESX using locally hosted vendors", async () => {
    const archive = streamingZip({ "line-items.pdf": makePdf(), "items.csv": encoder.encode(pricingCsv) });
    const result = await browserExtract("streamed.esx", archive);
    expect(result.error).toBeUndefined();
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toMatchObject({ name: "streamed.esx/line-items.pdf", text: "WTR.LAB Technician 0.5 HR 85.25", format: "text" });
    expect(requests).toContain("/vendor/fflate.mjs");
  }, 30000);

  it("rejects malformed PDF input using the real pdfjs worker", async () => {
    expect((await browserExtract("invalid.pdf", encoder.encode("%PDF-1.7\nnot a PDF document"))).error).toBeTruthy();
  }, 30000);
});
