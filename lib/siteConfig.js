const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://www.brothers.ad";

export const siteUrl = normalizeUrl(rawSiteUrl);

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "https://www.brothers.ad";
  try {
    const url = new URL(trimmed);
    return `${url.origin}`;
  } catch (_error) {
    return trimmed.replace(/\/+$/, "");
  }
}

