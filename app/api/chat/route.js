import { NextResponse } from "next/server";
import { cleanText, getClientIp, isRateLimited } from "../../../lib/securityUtils";

const CHAT_LIMIT_WINDOW_MS = 20_000;
const CHAT_LIMIT_MAX = 12;
const CHAT_MESSAGE_LIMIT = 1_000;

function buildReply(message) {
  const text = message.toLowerCase();

  if (
    text.includes("price") ||
    text.includes("pricing") ||
    text.includes("cost") ||
    text.includes("monthly") ||
    text.includes("package")
  ) {
    return "Packages start at $497/month for basic AI chat and review automation, $797/month for sales follow-up, and $997/month for operations workflows. For a precise recommendation, book the free audit or call 857-636-0833.";
  }

  if (text.includes("audit") || text.includes("book") || text.includes("call")) {
    return "You can book the free AI audit from the form on this page or call 857-636-0833. The audit maps your best automation opportunities, expected ROI, and a launch plan.";
  }

  if (text.includes("sales") || text.includes("lead") || text.includes("follow")) {
    return "For sales, start with missed-call recovery, quote follow-up, cold lead reactivation, and CRM pipeline updates. Those usually create the fastest ROI because they recover revenue already sitting in your pipeline.";
  }

  if (text.includes("review") || text.includes("google")) {
    return "For reviews, the strongest setup is an AI review protocol: request reviews after successful jobs, catch unhappy customers privately, draft response language, and track Google review growth.";
  }

  if (text.includes("operation") || text.includes("sop") || text.includes("document") || text.includes("contractor")) {
    return "For operations, an AI Operations OS can organize job files, photos, call summaries, tasks, estimates, invoices, SOPs, and daily reports. Contractors and restoration companies usually benefit from this quickly.";
  }

  if (text.includes("restoration")) {
    return "For the restoration side, Brothers.ad can support documentation, mitigation notes, Xactimate review workflows, customer updates, and sales follow-up. For active restoration service, use brothersrestoration.org or call 857-636-0833.";
  }

  return "A good first step is to automate one workflow that is repetitive, measurable, and tied to revenue: lead follow-up, review requests, customer service replies, or operations documentation. Book the free audit and we can map the best starting point.";
}

export async function POST(request) {
  const data = await request.json().catch(() => null);
  const message = cleanText(data?.message, CHAT_MESSAGE_LIMIT);
  const limiterKey = `chat:${getClientIp(request)}`;

  if (isRateLimited(limiterKey, CHAT_LIMIT_MAX, CHAT_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ reply: "You're sending messages quickly. Please pause for a moment." }, { status: 429 });
  }

  if (!message) {
    return NextResponse.json({ reply: "Ask me what you want AI to automate first." });
  }

  return NextResponse.json({ reply: buildReply(message) });
}
