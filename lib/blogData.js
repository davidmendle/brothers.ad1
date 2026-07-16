import { posts as fallbackPosts } from "./content";
import { firebaseConfig, hasFirebaseConfig } from "./firebaseConfig";

const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const BLOG_CACHE_TTL_MS = 30_000;

const cacheState = {
  posts: { value: null, updatedAt: 0 },
  postBySlug: new Map()
};

function getNowMs() {
  return Date.now();
}

function getPostCache() {
  return cacheState;
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function decodeFirestoreValue(value = {}) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nestedValue]) => [key, decodeFirestoreValue(nestedValue)])
    );
  }
  return undefined;
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeDocument(document) {
  const slug = document.name.split("/").pop();
  const data = Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
  return normalizePost(slug, data);
}

function normalizePost(slug, data) {
  const body = Array.isArray(data.body)
    ? data.body
    : String(data.body || "")
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

  return {
    slug,
    title: normalizeText(data.title || "Untitled AI Automation Article", 200),
    category: normalizeText(data.category || "AI Automation", 120),
    readTime: normalizeText(data.readTime || "5 min read", 80),
    excerpt: normalizeText(data.excerpt || "", 320),
    body,
    status: data.status || "published",
    scheduledAt: timestampToMillis(data.scheduledAt),
    publishedAt: timestampToMillis(data.publishedAt),
    imageUrl: normalizeText(data.imageUrl || "", 1_000),
    imageAlt: normalizeText(data.imageAlt || data.title || "Brothers.ad blog image", 170),
    sourceUrls: Array.isArray(data.sourceUrls) ? data.sourceUrls.filter(Boolean) : [],
    seoTitle: data.seoTitle || data.title || "",
    seoDescription: data.seoDescription || data.excerpt || "",
    updatedAt: timestampToMillis(data.updatedAt || data.createdAt),
    createdAt: timestampToMillis(data.createdAt)
  };
}

function mergePosts(dynamicPosts) {
  const bySlug = new Map();
  [...dynamicPosts, ...fallbackPosts.map((post) => normalizePost(post.slug, post))].forEach((post) => {
    if (!bySlug.has(post.slug)) bySlug.set(post.slug, post);
  });
  return [...bySlug.values()].sort((a, b) => {
    const aTime = a.publishedAt || a.updatedAt || a.createdAt || 0;
    const bTime = b.publishedAt || b.updatedAt || b.createdAt || 0;
    return bTime - aTime;
  });
}

async function fetchPublishedFirestorePosts() {
  const cache = getPostCache();
  const now = getNowMs();
  if (cache.posts.value && now - cache.posts.updatedAt < BLOG_CACHE_TTL_MS) {
    return cache.posts.value;
  }

  if (!hasFirebaseConfig) throw new Error("Firebase environment variables are missing");

  const response = await fetch(`${firestoreBaseUrl}:runQuery?key=${firebaseConfig.apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "blogPosts" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" }
          }
        }
      }
    }),
    next: { revalidate: 60 }
  });

  if (!response.ok) throw new Error(`Firestore query failed with ${response.status}`);
  const rows = await response.json();
  const posts = rows.filter((row) => row.document).map((row) => decodeDocument(row.document));

  cache.posts = {
    value: posts,
    updatedAt: now
  };
  return posts;
}

async function fetchFirestorePost(slug) {
  const cache = getPostCache();
  const cached = cache.postBySlug.get(slug);
  const now = getNowMs();
  if (cached && now - cached.updatedAt < BLOG_CACHE_TTL_MS) {
    return cached.value;
  }

  if (!hasFirebaseConfig) throw new Error("Firebase environment variables are missing");

  const response = await fetch(`${firestoreBaseUrl}/blogPosts/${encodeURIComponent(slug)}?key=${firebaseConfig.apiKey}`, {
    next: { revalidate: 60 }
  });

  if (!response.ok) throw new Error(`Firestore document fetch failed with ${response.status}`);
  const post = decodeDocument(await response.json());

  cache.postBySlug.set(slug, {
    value: post,
    updatedAt: now
  });
  return post;
}

export async function getPublishedPosts() {
  try {
    return mergePosts(await fetchPublishedFirestorePosts());
  } catch (error) {
    console.warn("Using fallback blog posts because Firestore blog fetch failed:", error?.message || error);
    return mergePosts([]);
  }
}

export async function getPostBySlug(slug) {
  try {
    const post = await fetchFirestorePost(slug);
    if (post.status === "published") return post;
  } catch (error) {
    console.warn("Using fallback blog post because Firestore post fetch failed:", error?.message || error);
  }

  const fallback = fallbackPosts.find((post) => post.slug === slug);
  return fallback ? normalizePost(fallback.slug, fallback) : null;
}
