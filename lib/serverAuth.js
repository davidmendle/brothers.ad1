const DEFAULT_ADMIN_EMAIL = "david@brothersrestoration.org";
const DEFAULT_BLOCKED_ADMIN_EMAILS = [
  "chaim@brothersrestoration.org",
  "reznikchaim@gmail.com"
];

function splitEmails(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getAllowedAdmins() {
  return [...new Set(splitEmails(process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL))];
}

function getBlockedAdmins() {
  return new Set([
    ...DEFAULT_BLOCKED_ADMIN_EMAILS,
    ...splitEmails(process.env.BLOCKED_ADMIN_EMAILS || process.env.NEXT_PUBLIC_BLOCKED_ADMIN_EMAILS)
  ]);
}

export function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function verifyFirebaseAdmin(request) {
  const idToken = getBearerToken(request);
  if (!idToken) {
    return { ok: false, status: 401, error: "Missing admin authorization token." };
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, error: "Firebase API key is not configured." };
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });

  if (!response.ok) {
    return { ok: false, status: 401, error: "Admin session could not be verified." };
  }

  const data = await response.json();
  const user = data.users?.[0];
  const email = String(user?.email || "").toLowerCase();
  const blockedAdmins = getBlockedAdmins();

  if (!user?.emailVerified || blockedAdmins.has(email) || !getAllowedAdmins().includes(email)) {
    return { ok: false, status: 403, error: "This account is not authorized to manage blog content." };
  }

  return { ok: true, user: { email, localId: user.localId } };
}
