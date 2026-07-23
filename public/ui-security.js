const moduleRoutePattern = /^#module\/([A-Za-z0-9_-]+)$/;

export function normalizeSectionButtonUrl(value, options = {}) {
  const url = String(value ?? "").trim();
  if (!url) return "";

  const moduleMatch = url.match(moduleRoutePattern);
  if (moduleMatch) {
    const key = moduleMatch[1];
    const allowedModuleKeys = Array.isArray(options.allowedModuleKeys) ? options.allowedModuleKeys : null;
    if (allowedModuleKeys && !allowedModuleKeys.includes(key)) return "";
    return `#module/${key}`;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function isSafeSectionButtonUrl(value, options = {}) {
  return Boolean(normalizeSectionButtonUrl(value, options));
}
