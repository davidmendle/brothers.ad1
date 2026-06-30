import { NextResponse } from "next/server";
import { verifyFirebaseAdmin } from "../../../../lib/serverAuth";

const MAX_BODY_BYTES = 6_000;

function clean(value, max = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function slugify(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "text" && content.text) return content.text;
    }
  }
  return "";
}

async function createArticle({ topic, audience, focus, length }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-5.5";
  const articleSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "slug",
      "category",
      "readTime",
      "excerpt",
      "body",
      "seoTitle",
      "seoDescription",
      "imagePrompt",
      "imageAlt",
      "sourceUrls"
    ],
    properties: {
      title: { type: "string" },
      slug: { type: "string" },
      category: { type: "string" },
      readTime: { type: "string" },
      excerpt: { type: "string" },
      body: {
        type: "array",
        minItems: 6,
        maxItems: 14,
        items: { type: "string" }
      },
      seoTitle: { type: "string" },
      seoDescription: { type: "string" },
      imagePrompt: { type: "string" },
      imageAlt: { type: "string" },
      sourceUrls: {
        type: "array",
        maxItems: 8,
        items: { type: "string" }
      }
    }
  };

  const prompt = [
    `Topic: ${topic}`,
    `Audience: ${audience}`,
    `Focus: ${focus}`,
    `Length: ${length}`,
    "",
    "Use public web information where useful. For OSHA, IICRC, building science, restoration, or compliance topics, prefer official or primary sources. Do not invent citations. Write in clear B2B language for an owner/operator. Avoid legal advice; frame compliance content as operational education and recommend checking official guidance. Return only the requested JSON."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      tools: [{ type: "web_search" }],
      input: [
        {
          role: "system",
          content:
            "You draft accurate, source-aware SEO blog posts for Brothers.ad. Produce practical articles about AI automation, B2B operations, restoration, IICRC/OSHA-adjacent building topics, and field documentation. Keep claims grounded and cite public URLs in sourceUrls."
        },
        { role: "user", content: prompt }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "brothers_ad_blog_post",
          strict: true,
          schema: articleSchema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI article generation failed with ${response.status}. ${errorText}`);
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  const article = JSON.parse(outputText);
  article.slug = slugify(article.slug || article.title);
  return article;
}

async function createImage(imagePrompt, title) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt: `${imagePrompt}\n\nCreate a clean, professional B2B blog hero image. No readable text, no logos, no brand impersonation. Topic: ${title}`,
      size: "1024x1024",
      quality: "medium",
      output_format: "jpeg",
      output_compression: 78
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI image generation failed with ${response.status}. ${errorText}`);
  }

  const data = await response.json();
  const imageBase64 = data.data?.[0]?.b64_json || "";
  return imageBase64 ? { mimeType: "image/jpeg", base64: imageBase64 } : null;
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const admin = await verifyFirebaseAdmin(request);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = await request.json().catch(() => null);
  const topic = clean(body?.topic, 240);
  if (!topic) return NextResponse.json({ error: "A topic or prompt is required." }, { status: 400 });

  const requestOptions = {
    topic,
    audience: clean(body?.audience, 160) || "B2B owners and operators",
    focus: clean(body?.focus, 200) || "Practical AI automation and operational improvement",
    length: clean(body?.length, 80) || "900 to 1,200 words"
  };

  try {
    const article = await createArticle(requestOptions);
    let image = null;
    let imageError = "";

    try {
      image = await createImage(article.imagePrompt, article.title);
    } catch (error) {
      imageError = error.message || "Image generation failed.";
    }

    return NextResponse.json({
      ok: true,
      article: {
        ...article,
        status: "draft"
      },
      image,
      imageError
    });
  } catch (error) {
    console.error("Blog generation failed:", error);
    return NextResponse.json({ error: error.message || "Could not generate the blog draft." }, { status: 502 });
  }
}
