import { NextResponse } from "next/server";

export async function POST(request) {
  const data = await request.json().catch(() => null);

  if (!data || !data.name || !data.email || !data.phone || !data.company) {
    return NextResponse.json({ error: "Name, email, phone, and company are required." }, { status: 400 });
  }

  const leadId = `BRS-AI-${Date.now().toString(36).toUpperCase()}`;

  return NextResponse.json({
    ok: true,
    leadId,
    message: "Audit request received.",
    nextStep: "A Brothers.ad team member will follow up using the contact details provided."
  });
}
