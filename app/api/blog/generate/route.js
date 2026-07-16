import { NextResponse } from "next/server";
import { verifyFirebaseAdmin } from "../../../../lib/serverAuth";
import { cleanText, ensureStringArray, getClientIp, isRateLimited } from "../../../../lib/securityUtils";

const MAX_BODY_BYTES = 6_000;
const GEN_RATE_LIMIT_MAX = 6;
const GEN_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_TEXT_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const MIN_BODY_PARAGRAPHS = 6;
const MAX_BODY_PARAGRAPHS = 14;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function clean(value, max = 240) {
  return cleanText(value, max);
}

function slugify(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function normalizeText(value, max = 220) {
  return clean(value, max);
}

function extractOutputText(response) {
  if (response?.error?.message) {
    throw new Error(response.error.message);
  }

  if (response.output_text) return response.output_text;

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) return content.text;
        if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
      }
    }
  }

  if (response.choices?.[0]?.message?.content) return response.choices[0].message.content;
  return "";
}

function normalizeResponseTextForJson(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\u0000/g, "").trim();
}

function parseLlmJson(rawText) {
  const cleaned = normalizeResponseTextForJson(rawText);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    // Handle markdown-wrapped JSON or model output with extra prose
  }

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_error) {}
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;

  try {
    return JSON.parse(objectMatch[0]);
  } catch (_error) {
    return null;
  }
}

function normalizeArticleFields(article) {
  const sourceUrls = ensureStringArray(article.sourceUrls, 8, 420);
  const body = normalizeBody(article.body);

  const title = normalizeText(article.title || "", 160);
  const seoTitle = normalizeText(article.seoTitle || article.title || title, 120);

  if (!title || body.length < MIN_BODY_PARAGRAPHS) {
    return null;
  }

  return {
    title,
    slug: slugify(article.slug || title),
    category: normalizeText(article.category || "AI Automation", 120),
    readTime: normalizeText(article.readTime || "5 min read", 80),
    excerpt: normalizeText(article.excerpt || "", 260),
    body,
    seoTitle,
    seoDescription: normalizeText(article.seoDescription || article.excerpt || "", 260),
    imagePrompt: normalizeText(article.imagePrompt || "", 420),
    imageAlt: normalizeText(article.imageAlt || article.title || "Brothers.ad blog image", 160),
    sourceUrls
  };
}

function normalizeBody(body) {
  if (!Array.isArray(body)) return [];

  const normalized = body.map((line) => clean(line, 900)).filter(Boolean);

  return Array.from(new Set(normalized)).slice(0, MAX_BODY_PARAGRAPHS);
}

function estimateBase64Bytes(base64Value) {
  const str = String(base64Value || "").replace(/=+$/, "");
  return Math.floor((str.length * 3) / 4);
}

function dedupeModels(models) {
  return [...new Set(models.filter(Boolean).map((model) => String(model).trim()).filter(Boolean))].slice(0, 5);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function requestArticle(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text().catch(() => "");
  const data = responseText ? safeJsonParse(responseText) : null;
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI article generation failed with ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

async function createArticle({ topic, audience, focus, length }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const models = dedupeModels([process.env.OPENAI_TEXT_MODEL, DEFAULT_TEXT_MODEL, "gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"]);
  const articleSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "slug", "category", "readTime", "excerpt", "body", "seoTitle", "seoDescription", "imagePrompt", "imageAlt", "sourceUrls"],
    properties: {
      title: { type: "string" },
      slug: { type: "string" },
      category: { type: "string" },
      readTime: { type: "string" },
      excerpt: { type: "string" },
      body: {
        type: "array",
        minItems: MIN_BODY_PARAGRAPHS,
        maxItems: MAX_BODY_PARAGRAPHS,
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

  let lastError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const payload = {
      model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "You draft accurate, source-aware SEO blog posts for Brothers.ad. Produce practical articles about AI automation, B2B operations, restoration, IICRC/OSHA-adjacent building topics, and field documentation. Keep claims grounded and cite public URLs in sourceUrls. Use crisp, professional B2B tone with varied language and clear structure. No repetitive opening phrases."
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
    };

    if (index === 0) {
      payload.tools = [{ type: "web_search" }];
    }

    try {
      const responseData = await requestArticle(payload);
      const outputText = extractOutputText(responseData);
      const article = parseLlmJson(outputText);
      if (!article) {
        throw new Error("OpenAI returned an empty or unparsable article payload.");
      }

      const normalizedArticle = normalizeArticleFields(article);
      if (!normalizedArticle) {
        throw new Error("OpenAI returned an incomplete blog payload.");
      }

      return normalizedArticle;
    } catch (error) {
      const message = String(error.message || "Unknown LLM error");
      lastError = error;
      if (index < models.length - 1) {
        if (/(model|deprecated|not found|not supported|tool|web_search|invalid_request_error)/i.test(message)) continue;
      }
      break;
    }
  }

  throw lastError || new Error("OpenAI article generation failed after trying fallback models.");
}

async function createImage(imagePrompt, title) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const models = dedupeModels([process.env.OPENAI_IMAGE_MODEL, DEFAULT_IMAGE_MODEL, "gpt-image-1"]);
  const prompt = `${imagePrompt}\n\nCreate a clean, professional B2B blog hero image. No readable text, no logos, no brand impersonation. Topic: ${title}`;
  let lastError = null;

  for (const model of models) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        quality: "standard",
        output_format: "jpeg",
        output_compression: 76
      })
    });

    const responseText = await response.text().catch(() => "");
    const data = responseText ? safeJsonParse(responseText) : null;
    if (!response.ok) {
      lastError = new Error(
        data?.error?.message ||
          `OpenAI image generation failed with ${response.status}. ${responseText}`
      );
      if (/(model|deprecated|not found|not supported|invalid_request_error)/i.test(lastError.message) && models[models.length - 1] !== model) {
        continue;
      }
      break;
    }

    const imageBase64 = data?.data?.[0]?.b64_json || "";
    if (imageBase64) {
      return {
        mimeType: "image/jpeg",
        base64: imageBase64
      };
    }
  }

  throw lastError || new Error("OpenAI image generation failed.");
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const admin = await verifyFirebaseAdmin(request);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const rateKey = `blog-generate:${admin.user?.email || getClientIp(request)}`;
  if (isRateLimited(rateKey, GEN_RATE_LIMIT_MAX, GEN_RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many generation requests. Please wait a moment." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

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

    if (article.imagePrompt) {
      try {
        image = await createImage(article.imagePrompt, article.title);
        if (image?.base64 && estimateBase64Bytes(image.base64) > IMAGE_MAX_BYTES) {
          image = null;
          imageError = "Generated image skipped because it was too large to upload safely.";
        }
      } catch (error) {
        imageError = error.message || "Image generation failed.";
      }
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
