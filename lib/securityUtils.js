const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 20;
const MAX_RATE_LIMIT_ENTRIES = 5000;

let cleanupCounter = 0;

function getRateLimitStore() {
  if (!globalThis.__brothersSecurityRateLimits) {
    globalThis.__brothersSecurityRateLimits = new Map();
  }
  return globalThis.__brothersSecurityRateLimits;
}

function pruneRateLimitStore(store, maxEntries = MAX_RATE_LIMIT_ENTRIES) {
  if (store.size <= maxEntries) return;

  const ordered = [...store.entries()]
    .filter(([, value]) => value && typeof value === "object" && Number.isFinite(value.windowStart))
    .sort((a, b) => a[1].windowStart - b[1].windowStart);
  const removeCount = Math.max(1, Math.ceil((ordered.length - maxEntries) * 0.3));
  for (let i = 0; i < removeCount; i += 1) {
    store.delete(ordered[i][0]);
  }
}

export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export function isRateLimited(identifier, limit = DEFAULT_MAX_REQUESTS, windowMs = DEFAULT_WINDOW_MS) {
  cleanupCounter += 1;
  const store = getRateLimitStore();
  const now = Date.now();
  const bucket = store.get(identifier) || { count: 0, windowStart: now };

  if (now - bucket.windowStart > windowMs) {
    store.set(identifier, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  store.set(identifier, bucket);

  if (cleanupCounter > 256) {
    cleanupCounter = 0;
    pruneRateLimitStore(store);
  }

  return bucket.count > limit;
}

export function cleanText(value, maxLength = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function ensureStringArray(value, maxItems = 8, maxLength = 200) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, maxItems);
}

export function sanitizeJsonForDom(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
