import { NextResponse } from "next/server";
import { cleanText, getClientIp, isRateLimited } from "../../../lib/securityUtils";

const LEAD_NOTIFICATION_TO = process.env.LEAD_NOTIFICATION_TO || "david@brothersrestoration.org";
const DEFAULT_FROM = "Brothers.ad <onboarding@resend.dev>";
const MAX_BODY_BYTES = 12_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 6;

const fieldLimits = {
  name: 120,
  email: 160,
  phone: 60,
  company: 160,
  package: 80,
  message: 1500
};

function normalizeLead(data) {
  return {
    name: cleanText(data.name, fieldLimits.name),
    email: cleanText(data.email, fieldLimits.email).toLowerCase(),
    phone: cleanText(data.phone, fieldLimits.phone),
    company: cleanText(data.company, fieldLimits.company),
    package: cleanText(data.package, fieldLimits.package) || "Not specified",
    message: cleanText(data.message, fieldLimits.message)
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildEmailText(lead, leadId) {
  return [
    `New Brothers.ad AI audit lead: ${leadId}`,
    "",
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone}`,
    `Company: ${lead.company}`,
    `Package Interest: ${lead.package}`,
    "",
    "Message:",
    lead.message || "No message provided."
  ].join("\n");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function buildEmailHtml(lead, leadId) {
  const rows = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Company", lead.company],
    ["Package Interest", lead.package],
    ["Message", lead.message || "No message provided."]
  ];

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2>New Brothers.ad AI audit lead</h2>
      <p><strong>Confirmation ID:</strong> ${escapeHtml(leadId)}</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px">
        ${rows
          .map(
            ([label, value]) => `
              <tr>
                <td style="border:1px solid #e2e8f0;background:#f8fafc;font-weight:bold;width:170px">${escapeHtml(label)}</td>
                <td style="border:1px solid #e2e8f0">${escapeHtml(value)}</td>
              </tr>
            `
          )
          .join("")}
      </table>
    </div>
  `;
}

async function sendLeadEmail(lead, leadId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Lead email delivery is not configured.");
  }

  const recipients = LEAD_NOTIFICATION_TO.split(",")
    .map((email) => email.trim())
    .filter((email) => isValidEmail(email));

  if (!recipients.length) {
    throw new Error("Lead notification recipient list is empty.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.LEAD_NOTIFICATION_FROM || DEFAULT_FROM,
      to: recipients,
      reply_to: lead.email,
      subject: `New Brothers.ad AI audit lead: ${lead.company}`,
      text: buildEmailText(lead, leadId),
      html: buildEmailHtml(lead, leadId)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Lead email delivery failed with status ${response.status}. ${errorText}`);
  }
}

export async function POST(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const ip = getClientIp(request);
  if (isRateLimited(`audit:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const data = await request.json().catch(() => null);

  if (data?.website) {
    return NextResponse.json({ ok: true, leadId: `BRS-AI-${Date.now().toString(36).toUpperCase()}` });
  }

  const lead = normalizeLead(data || {});

  if (!lead.name || !lead.email || !lead.phone || !lead.company) {
    return NextResponse.json({ error: "Name, email, phone, and company are required." }, { status: 400 });
  }

  if (!isValidEmail(lead.email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const leadId = `BRS-AI-${Date.now().toString(36).toUpperCase()}`;

  try {
    await sendLeadEmail(lead, leadId);
  } catch (error) {
    console.error("Brothers.ad lead email failed:", error);
    return NextResponse.json(
      { error: "The request could not be emailed. Please call 857-636-0833 or try again shortly." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    leadId,
    message: "Audit request received.",
    nextStep: "A Brothers.ad team member will follow up using the contact details provided."
  });
}
