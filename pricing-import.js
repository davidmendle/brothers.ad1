const aliases = {
  code: ["code", "catselector", "catsel", "lineitemcode", "itemcode"],
  selector: ["selector", "sel"],
  category: ["category", "cat", "trade", "group"],
  name: ["description", "lineitemdescription", "name", "item", "desc"],
  unit: ["unit", "uom", "unitofmeasure", "measure"],
  qty: ["quantity", "qty", "count"],
  rate: ["unitprice", "unitrate", "unitcost", "priceperunit", "rate", "price"],
  cost: ["cost"],
  branch: ["branch", "location", "market"],
  justification: ["justification", "notes", "note", "scope"]
};
const itemElements = new Set(["lineitem", "item", "estimateitem", "rec", "estimateline"]);
const normalizeKey = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const issue = (code, message, row = null) => ({ code, message, row });
const rejected = (format, code, message, row = null) => ({
  status: "rejected", format, lines: [], issues: [issue(code, message, row)], skippedRows: 0
});

function complete(format, lines, issues, skippedRows) {
  if (!lines.length && !issues.length) issues.push(issue("no-pricing-lines", "No pricing lines were found."));
  return { status: lines.length ? (issues.length ? "partial" : "ready") : "rejected", format, lines, issues, skippedRows };
}

// Missing, malformed, and locale-ambiguous amounts must not silently become zero.
function numberFrom(value, money = false) {
  let text = String(value ?? "").trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (money) {
    const signBeforeCurrency = text.match(/^([+-])(?=(?:USD|US\$|\$))/i)?.[1] || "";
    if (signBeforeCurrency) text = text.slice(1);
    text = text.replace(/^(?:USD\s*|US\$\s*|\$\s*)/i, "").replace(/\s*USD$/i, "");
    if (signBeforeCurrency && /^[+-]/.test(text)) return null;
    text = signBeforeCurrency + text;
  }
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$|^[+-]?\.\d+$/.test(text)) return null;
  if (negative && /^[+-]/.test(text)) return null;
  const valueNumber = Number(text.replace(/,/g, "")) * (negative ? -1 : 1);
  return Number.isFinite(valueNumber) && Math.abs(valueNumber) <= Number.MAX_SAFE_INTEGER ? valueNumber : null;
}

function lineFrom(get, source, row, issues) {
  const name = get("name").trim();
  const unit = get("unit").trim();
  const rateText = get("rate");
  const qtyText = get("qty");
  const rate = numberFrom(rateText, true);
  const qty = qtyText === undefined ? 1 : numberFrom(qtyText);
  if (!name || !unit || rate === null || qty === null) {
    const missing = !name ? "description" : !unit ? "unit" : rate === null ? "unit price" : "quantity";
    issues.push(issue("invalid-line", `Missing or invalid ${missing}; use explicit unit prices, not RCV or line totals.`, row));
    return null;
  }
  const category = get("category").trim();
  const selector = get("selector").trim();
  const code = get("code").trim() || (selector ? [category, selector].filter(Boolean).join(".") : "");
  const line = { code: code.toUpperCase(), name, unit: unit.toLowerCase(), qty, rate, source };
  for (const field of ["category", "branch", "justification"]) {
    const value = get(field).trim();
    if (value) line[field] = value;
  }
  const costText = get("cost");
  if (costText) {
    const cost = numberFrom(costText, true);
    if (cost === null) {
      issues.push(issue("invalid-cost", "Invalid cost; the row was not imported.", row));
      return null;
    }
    line.cost = cost;
  }
  return line;
}

function readDelimited(text, delimiter, maxRows) {
  const rows = [];
  let cells = [], field = "", quoted = false, closed = false, row = 1, startRow = 1;
  const finishField = () => { cells.push(field.trim()); field = ""; closed = false; };
  const finishRow = () => {
    finishField();
    if (cells.some(Boolean)) rows.push({ cells, row: startRow });
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else {
        if (char === "\r" || char === "\n") {
          if (char === "\r" && text[index + 1] === "\n") index += 1;
          field += "\n";
          row += 1;
        } else field += char;
      }
    } else if (char === delimiter) finishField();
    else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row += 1;
      startRow = row;
      if (rows.length > maxRows + 30) return { error: issue("row-limit", `The import exceeds ${maxRows} pricing rows.`) };
    } else if (char === '"') {
      if (field.trim() || closed) return { error: issue("invalid-csv", "Unexpected quote in an unquoted field.", row) };
      field = "";
      quoted = true;
    } else if (closed && !/\s/.test(char)) {
      return { error: issue("invalid-csv", "Unexpected text after a quoted field.", row) };
    } else if (!closed) field += char;
  }
  if (quoted) return { error: issue("invalid-csv", "A quoted field is missing its closing quote.", startRow) };
  finishRow();
  return { rows };
}

function headerMap(cells) {
  const keys = cells.map(normalizeKey);
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [
    field, names.map((name) => keys.indexOf(name)).find((index) => index >= 0) ?? -1
  ]));
}

function parseDelimited(text, source, delimiter, maxRows) {
  const format = delimiter === "\t" ? "tsv" : "csv";
  const parsed = readDelimited(text, delimiter, maxRows);
  if (parsed.error) return rejected(format, parsed.error.code, parsed.error.message, parsed.error.row);
  const rows = parsed.rows;
  const headerIndex = rows.slice(0, 30).findIndex(({ cells }) => {
    const map = headerMap(cells);
    return map.name >= 0 && map.rate >= 0;
  });
  if (headerIndex < 0) return rejected(format, "missing-headers", "Include Description, Unit, and Unit Price headers. RCV, Amount, and Total are not unit prices.");
  const header = rows[headerIndex];
  const map = headerMap(header.cells);
  if (map.unit < 0) return rejected(format, "missing-unit-header", "A Unit or UOM column is required.", header.row);
  const recognized = Object.entries(aliases).filter(([, names]) => header.cells.filter((cell) => names.includes(normalizeKey(cell))).length > 1);
  if (recognized.length) return rejected(format, "ambiguous-headers", `Multiple columns describe ${recognized.map(([field]) => field).join(", ")}; keep one column for each field.`, header.row);
  const body = rows.slice(headerIndex + 1);
  if (body.length > maxRows) return rejected(format, "row-limit", `The import exceeds ${maxRows} pricing rows.`);
  const lines = [], issues = [];
  let skippedRows = headerIndex;
  if (headerIndex) issues.push(issue("skipped-preamble", `Skipped ${headerIndex} row(s) before the pricing headers.`));
  for (const record of body) {
    if (record.cells.map(normalizeKey).join("|") === header.cells.map(normalizeKey).join("|")) {
      skippedRows += 1;
      issues.push(issue("repeated-header", "Skipped a repeated header row.", record.row));
      continue;
    }
    if (record.cells.length !== header.cells.length) {
      skippedRows += 1;
      issues.push(issue("column-count", `Expected ${header.cells.length} fields; quote commas inside descriptions and currency values.`, record.row));
      continue;
    }
    const line = lineFrom((field) => map[field] < 0 ? (field === "qty" ? undefined : "") : record.cells[map[field]], source, record.row, issues);
    if (line) lines.push(line);
    else skippedRows += 1;
  }
  return complete(format, lines, issues, skippedRows);
}

function parseText(text, source, maxRows) {
  const rows = text.split(/\r\n|\n|\r/);
  if (rows.length > maxRows) return rejected("text", "row-limit", `The import exceeds ${maxRows} text rows.`);
  const lines = [], issues = [];
  let skippedRows = 0;
  const pattern = /^\s*(?:\d+[.)]\s+)?([A-Z]{2,5}[.\-\s][A-Z0-9+></#_\-]+)\s+(.+?)\s+([+-]?[\d,]*\.?\d+)\s+(EA|SF|LF|HR|DAY|DAYS|SQ|SY|YD|CY|CF|WK|MO|GAL|LB|ITEM|EACH)\s+((?:USD\s*|US\$\s*|\$\s*)?[+-]?[\d,]*\.?\d+|\((?:\$\s*)?[\d,]*\.?\d+\))\s*$/i;
  rows.forEach((textRow, index) => {
    if (!textRow.trim()) return;
    const match = textRow.match(pattern);
    if (!match) {
      skippedRows += 1;
      issues.push(issue("unrecognized-text-row", "Expected Code Description Quantity Unit UnitPrice; use CSV for reports with additional financial columns.", index + 1));
      return;
    }
    const fields = { code: match[1].replace(/\s+/g, "."), name: match[2], qty: match[3], unit: match[4], rate: match[5] };
    const line = lineFrom((field) => fields[field] ?? "", source, index + 1, issues);
    if (line) lines.push(line);
    else skippedRows += 1;
  });
  return complete("text", lines, issues, skippedRows);
}

function parseXml(text, source, Parser, maxRows) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) return rejected("xml", "unsafe-xml", "XML document types and entity declarations are not supported.");
  if (typeof Parser !== "function") return rejected("xml", "xml-parser-unavailable", "XML import requires a DOMParser implementation.");
  let document;
  try { document = new Parser().parseFromString(text, "application/xml"); }
  catch { return rejected("xml", "invalid-xml", "The XML file could not be parsed."); }
  const nodes = Array.from(document.getElementsByTagName("*"));
  if (!document.documentElement || nodes.some((node) => normalizeKey(node.localName || node.nodeName) === "parsererror")) {
    return rejected("xml", "invalid-xml", "The XML file is malformed; export a complete XML document.");
  }
  const candidates = nodes.filter((node) => itemElements.has(normalizeKey(node.localName || node.nodeName)));
  if (candidates.length > maxRows) return rejected("xml", "row-limit", `The import exceeds ${maxRows} XML pricing rows.`);
  const lines = [], issues = [];
  let skippedRows = 0;
  candidates.forEach((node, index) => {
    // Read only this record's attributes and direct fields, never nested component prices.
    const values = new Map();
    const insert = (key, value) => {
      const normalized = normalizeKey(key);
      if (!values.has(normalized)) values.set(normalized, []);
      values.get(normalized).push(value.trim());
    };
    Array.from(node.attributes || []).forEach((attribute) => insert(attribute.localName || attribute.name, attribute.value));
    Array.from(node.childNodes || []).filter((child) => child.nodeType === 1 && !Array.from(child.childNodes || []).some((part) => part.nodeType === 1))
      .forEach((child) => insert(child.localName || child.nodeName, child.textContent || ""));
    let ambiguous = false;
    const get = (field) => {
      const found = aliases[field].flatMap((name) => values.get(name) || []);
      if (new Set(found).size > 1) ambiguous = true;
      return found[0] ?? (field === "qty" ? undefined : "");
    };
    const line = lineFrom(get, source, index + 1, issues);
    if (ambiguous) {
      issues.push(issue("ambiguous-xml-fields", "The XML record contains conflicting values for the same pricing field.", index + 1));
      skippedRows += 1;
    } else if (line) lines.push(line);
    else skippedRows += 1;
  });
  return complete("xml", lines, issues, skippedRows);
}

/**
 * Parse explicit line-item exports only. No file access, generated IDs, deduplication,
 * price-policy changes, or inferred rates. A partial result requires caller review.
 * XML accepts attributes/direct leaf fields on lineItem/item/estimateItem/rec/estimateLine.
 * Supply format only for a document decoded by a real PDF/archive/workbook extractor.
 */
export function parsePricingImport(text, { fileName = "Pricing import", format = "auto", DOMParser: Parser = globalThis.DOMParser, maxRows = 20000, maxCharacters = 8000000 } = {}) {
  if (typeof text !== "string") return rejected("unknown", "text-required", "Provide decoded CSV, TSV, text, or XML, not a binary file.");
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    return rejected("unknown", "invalid-limits", "Import limits must be positive integers.");
  }
  if (!["auto", "csv", "tsv", "text", "xml"].includes(format)) return rejected("unknown", "unsupported-format", "Supported decoded formats are CSV, TSV, text, and XML.");
  if (text.length > maxCharacters) return rejected("unknown", "size-limit", `The import exceeds ${maxCharacters} characters.`);
  const source = String(fileName);
  const extension = source.toLowerCase().split(/[\\/]/).pop().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (format === "auto" && ["esx", "zip", "pdf", "xlsx", "xls", "xlsm", "xlsb", "xlp"].includes(extension)) {
    return rejected("unsupported", "unsupported-file", "ESX packages, PDFs, and workbooks are not text pricing exports. Export line items to Excel in Xactimate, then save the relevant sheet as CSV (including Description, Unit, and Unit Price).");
  }
  const content = text.replace(/^\uFEFF/, "").trim();
  if (!content) return rejected("unknown", "empty-file", "The pricing file is empty.");
  if (/^(?:PK[\u0003\u0005\u0007]|%PDF-|\u00d0\u00cf\u0011\u00e0)/.test(content) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(content)) {
    return rejected("unsupported", "binary-content", "The input contains binary data or undecodable text. Use an uncompressed UTF-8 CSV, TSV, text, or XML export.");
  }
  if (format === "xml") return parseXml(content, source, Parser, maxRows);
  if (format === "text") return parseText(content, source, maxRows);
  if (format === "tsv") return parseDelimited(content, source, "\t", maxRows);
  if (format === "auto" && (content.startsWith("<") || extension === "xml")) return parseXml(content, source, Parser, maxRows);
  const separatorDirective = content.match(/^sep=([,;\t])(?:\r\n|\r|\n)/i);
  if (separatorDirective) {
    const result = parseDelimited(content.slice(separatorDirective[0].length), source, separatorDirective[1], maxRows);
    result.issues.forEach((item) => { if (item.row !== null) item.row += 1; });
    return result;
  }
  const sample = content.split(/\r\n|\r|\n/).slice(0, 30);
  const delimiterScore = (separator) => Math.max(...sample.map((row) => {
    const map = headerMap(row.split(separator));
    return map.name >= 0 ? Object.values(map).filter((index) => index >= 0).length : 0;
  }));
  const delimiter = format === "auto" && extension === "tsv" ? "\t" : [",", "\t", ";"].sort((left, right) => delimiterScore(right) - delimiterScore(left))[0];
  const looksDelimited = format === "csv" || ["csv", "tsv"].includes(extension) || sample.some((row) => {
    const map = headerMap(row.split(delimiter));
    return map.name >= 0 && (map.rate >= 0 || row.split(delimiter).some((cell) => ["rcv", "amount", "total"].includes(normalizeKey(cell))));
  });
  return looksDelimited ? parseDelimited(content, source, delimiter, maxRows) : parseText(content, source, maxRows);
}
