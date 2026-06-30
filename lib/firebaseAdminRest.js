import crypto from "node:crypto";

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function getPrivateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

function requireAdminConfig() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase service account env vars are missing.");
  }

  return { projectId, clientEmail, privateKey };
}

async function getAccessToken() {
  const { clientEmail, privateKey } = requireAdminConfig();
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64Url({ alg: "RS256", typ: "JWT" }),
    base64Url({
      iss: clientEmail,
      scope: FIRESTORE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  ].join(".");

  const signature = crypto.createSign("RSA-SHA256").update(unsignedJwt).sign(privateKey, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Could not create Firebase admin access token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, firestoreValue(nested)]))
      }
    };
  }
  return { stringValue: String(value) };
}

export function decodeFirestoreValue(value = {}) {
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

export function decodeFirestoreDocument(document) {
  return {
    id: document.name.split("/").pop(),
    ...Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
    )
  };
}

function firestoreBaseUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

export async function runFirestoreQuery(structuredQuery) {
  const { projectId } = requireAdminConfig();
  const accessToken = await getAccessToken();
  const response = await fetch(`${firestoreBaseUrl(projectId)}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ structuredQuery })
  });

  if (!response.ok) {
    throw new Error(`Firestore admin query failed with ${response.status}`);
  }

  return response.json();
}

export async function patchFirestoreDocument(collection, documentId, fields) {
  const { projectId } = requireAdminConfig();
  const accessToken = await getAccessToken();
  const updateMask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");

  const response = await fetch(
    `${firestoreBaseUrl(projectId)}/${collection}/${encodeURIComponent(documentId)}?${updateMask}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]))
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Firestore admin update failed with ${response.status}`);
  }

  return response.json();
}

