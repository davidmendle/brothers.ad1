import { NextResponse } from "next/server";
import { decodeFirestoreDocument, patchFirestoreDocument, runFirestoreQuery } from "../../../../lib/firebaseAdminRest";
import { getBearerToken, verifyFirebaseAdmin } from "../../../../lib/serverAuth";
import { getClientIp, isRateLimited } from "../../../../lib/securityUtils";

const PUBLISH_DUE_RATE_LIMIT_MAX = 4;
const PUBLISH_DUE_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_DUE_PUBLISH = 150;

async function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET || process.env.BLOG_CRON_SECRET;
  const bearer = getBearerToken(request);
  const cronToken = request.nextUrl?.searchParams?.get("token") || "";
  if (cronSecret && (bearer === cronSecret || cronToken === cronSecret)) return { ok: true, type: "cron" };
  if (request.headers.get("x-vercel-cron") === "1" && cronSecret) return { ok: true, type: "cron" };

  const admin = await verifyFirebaseAdmin(request);
  if (admin.ok) return { ok: true, type: "admin", user: admin.user };
  return admin;
}

async function publishDuePosts() {
  const rows = await runFirestoreQuery({
    from: [{ collectionId: "blogPosts" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "status" },
        op: "EQUAL",
        value: { stringValue: "scheduled" }
      }
    }
  });

  const now = new Date();
  const scheduledPosts = rows.filter((row) => row.document).map((row) => decodeFirestoreDocument(row.document));
  const duePosts = scheduledPosts
    .filter((post) => {
      const scheduledAt = post.scheduledAt ? new Date(post.scheduledAt) : null;
      return scheduledAt && !Number.isNaN(scheduledAt.valueOf()) && scheduledAt <= now;
    })
    .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0))
    .slice(0, MAX_DUE_PUBLISH);

  const published = [];
  for (const post of duePosts) {
    await patchFirestoreDocument("blogPosts", post.id, {
      status: "published",
      publishedAt: now,
      updatedAt: now
    });
    published.push(post.id);
  }

  return { checked: scheduledPosts.length, published };
}

async function handler(request) {
  const authorized = await isAuthorized(request);
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error || "Not authorized." }, { status: authorized.status || 401 });
  }

  const rateKey = `blog-publish-due:${authorized.user?.email || getClientIp(request)}`;
  if (isRateLimited(rateKey, PUBLISH_DUE_RATE_LIMIT_MAX, PUBLISH_DUE_RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many publish attempts. Try again soon." }, { status: 429 });
  }

  try {
    const result = await publishDuePosts();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Scheduled blog publisher failed:", error);
    return NextResponse.json({ error: error.message || "Could not publish scheduled posts." }, { status: 502 });
  }
}

export async function GET(request) {
  return handler(request);
}

export async function POST(request) {
  return handler(request);
}
