import { NextResponse } from "next/server";
import { decodeFirestoreDocument, patchFirestoreDocument, runFirestoreQuery } from "../../../../lib/firebaseAdminRest";
import { getBearerToken, verifyFirebaseAdmin } from "../../../../lib/serverAuth";

async function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET || process.env.BLOG_CRON_SECRET;
  const bearer = getBearerToken(request);
  if (cronSecret && bearer === cronSecret) return { ok: true, type: "cron" };

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
  const duePosts = scheduledPosts.filter((post) => {
    const scheduledAt = post.scheduledAt ? new Date(post.scheduledAt) : null;
    return scheduledAt && !Number.isNaN(scheduledAt.valueOf()) && scheduledAt <= now;
  });

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
