const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4 * 1024 * 1024;
const readable = /\.(csv|tsv|txt|xml|pdf|esx|zip)$/i;

function textFromBytes(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

export async function extractPricingDocuments(file, dependencies = {}) {
  if (!readable.test(file.name)) throw new Error("Choose a CSV, TSV, TXT, XML, PDF, or ESX export.");
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Pricing files must be non-empty and no larger than 25 MB.");
  const documents = [];
  let expanded = 0;
  let actualExpanded = 0;
  let textLength = 0;
  let entries = 0;
  function add(name, text, format) {
    textLength += text.length;
    if (textLength > MAX_TEXT_LENGTH) throw new Error("This export contains too much text. Split it into smaller exports.");
    if (text.trim()) documents.push({ name, text, format });
  }
  async function read(name, bytes, depth) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      if (depth >= 3) throw new Error("This ESX archive has too many nested packages.");
      const { unzip } = dependencies.fflate || await import("./vendor/fflate.mjs");
      const declaredSizes = new Map();
      const unpacked = await new Promise((resolve, reject) => {
        let terminate;
        let filterError;
        let settled = false;
        let failed = false;
        let terminated = false;
        const stop = () => {
          if (terminate && !terminated) { terminated = true; terminate(); }
        };
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          failed = Boolean(error);
          clearTimeout(timer);
          if (error) { stop(); reject(error); }
          else resolve(result);
        };
        const timer = setTimeout(() => finish(new Error("The pricing archive took too long to unpack.")), 30000);
        try {
          terminate = unzip(bytes, { filter(entry) {
            if (filterError) return false;
            if (++entries > 1000) { filterError = new Error("The archive contains too many files."); return false; }
            if (!readable.test(entry.name) || entry.name.endsWith("/")) return false;
            if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
              filterError = new Error("The archive declares an invalid expanded file size."); return false;
            }
            if (declaredSizes.has(entry.name)) { filterError = new Error("The archive contains duplicate document names."); return false; }
            expanded += entry.originalSize;
            if (expanded > MAX_EXPANDED_BYTES || entry.originalSize > MAX_FILE_BYTES) {
              filterError = new Error("The expanded archive exceeds the pricing import size limit."); return false;
            }
            declaredSizes.set(entry.name, entry.originalSize);
            return true;
          } }, (error, result) => finish(filterError || error, result));
          if (filterError) finish(filterError);
          if (failed) stop();
        } catch (error) { finish(error); }
      });
      for (const [entryName, data] of Object.entries(unpacked)) {
        if (declaredSizes.get(entryName) !== data.byteLength) throw new Error("An archive document has an inconsistent expanded size.");
        actualExpanded += data.byteLength;
        if (actualExpanded > MAX_EXPANDED_BYTES || data.byteLength > MAX_FILE_BYTES) throw new Error("The expanded archive exceeds the pricing import size limit.");
        await read(`${name}/${entryName}`, data, depth + 1);
      }
      return;
    }
    if (/\.(esx|zip)$/i.test(name)) throw new Error("This ESX is not a supported ZIP package. Export its line items as CSV, XML, or a text-based PDF from Xactimate.");
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      const pdfjs = dependencies.pdfjs || await import("./vendor/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
      const loading = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true });
      let timeout;
      let expired = false;
      const deadline = new Promise((resolve, reject) => {
        timeout = setTimeout(() => { expired = true; reject(new Error("The PDF took too long to extract. Export a smaller line-item report.")); }, 45000);
      });
      try {
        const text = await Promise.race([deadline, (async () => {
          const pdf = await loading.promise;
          if (pdf.numPages > 200) throw new Error("This PDF exceeds 200 pages. Export a smaller line-item report.");
          const pages = [];
          let length = 0;
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            try {
              const content = await page.getTextContent();
              const items = content.items.filter((item) => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5]);
              const rows = [];
              for (const item of items) {
                const y = item.transform[5];
                let row = rows[rows.length - 1];
                if (!row || Math.abs(row.y - y) >= 2) { row = { y, items: [] }; rows.push(row); }
                row.items.push({ x: item.transform[4], text: item.str });
                length += item.str.length + 1;
                if (length + textLength > MAX_TEXT_LENGTH) throw new Error("This PDF contains too much text for one import.");
              }
              pages.push(rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")).join("\n"));
            } finally { page.cleanup(); }
          }
          return pages.join("\n");
        })()]);
        if (!text.trim()) throw new Error("This PDF has no selectable text. Export a text-based line-item report or CSV from Xactimate.");
        add(name, text, "text");
      } finally {
        clearTimeout(timeout);
        const cleanup = loading.destroy().catch(() => {});
        if (!expired) await cleanup;
      }
      return;
    }
    if (/\.pdf$/i.test(name)) throw new Error("This file does not contain a valid PDF header. Export a text-based PDF or CSV from Xactimate.");
    const text = textFromBytes(bytes).replace(/^\uFEFF/, "");
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ufffd]/.test(text)) throw new Error("This export contains proprietary, binary, or undecodable data. Export its line items as CSV, XML, or a text-based PDF from Xactimate.");
    const format = /\.csv$/i.test(name) ? "csv" : /\.tsv$/i.test(name) ? "tsv" : /\.xml$/i.test(name) || /^\s*</.test(text) ? "xml" : "text";
    add(name, text, format);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES || bytes.byteLength !== file.size) throw new Error("Pricing file size is inconsistent or exceeds 25 MB.");
  await read(file.name, bytes, 0);
  if (!documents.length) throw new Error("No readable pricing documents were found. Export the estimate's line items as CSV, XML, or a text-based PDF.");
  return documents;
}
