# Emergency Incident Intake

Provider-neutral incident intake, owner review, and explicit dispatch linking. No provider is connected by this implementation. No sample/live incidents, radio transcription, property-owner lookup, contact enrichment, or automatic outreach are generated. Use only licensed/authorized incident feeds. Providers must omit homeowner names, telephone numbers, email addresses, victim details, and other personal contact information, including in free-text incident summaries.

## Runtime and Authentication

- Node.js with the existing Express/Firebase Admin integration. Persistent Firestore access is mandatory; there is no memory, filesystem, SQLite, or browser-storage fallback.
- Office endpoints use the existing `brothers_os_session` Firebase session, including revocation checks. Only `business_owner`, or `super_admin` passing the existing owner identity check, can use these endpoints. Both require effective access and application visibility for the `dispatch` module. Other roles are denied even if they have dispatch visibility.
- The company comes exclusively from the verified session. Even the real owner cannot use these routes to choose another company. Body/query tenant overrides are rejected.
- Webhook authentication is independent of office sessions: each configured source's HMAC secret authenticates that provider, and its server-side `companyId` selects the tenant.
- Keep the existing deny-by-default Firestore client rules. No new client read/write grants are necessary or appropriate. Only the server's Admin SDK accesses the emergency collection.

## Environment

Set server-only `EMERGENCY_FEEDS_JSON` to a JSON **array**. Do not use a `NEXT_PUBLIC_` variable or put secrets in browser code, source control, logs, or URLs.

```json
[
  {
    "id": "county-dispatch",
    "label": "County Dispatch",
    "area": "Example County",
    "companyId": "default-company",
    "secret": "REPLACE_WITH_A_UNIQUE_CRYPTOGRAPHIC_RANDOM_SECRET",
    "streamUrl": "https://authorized-provider.example/listen"
  }
]
```

- `id`: unique, 1-80 ASCII letters/digits/underscores/hyphens; first character must be a letter/digit. Keep stable across retries. `_manual` is reserved internally and is not a valid configured source ID.
- `label`, `area`: non-empty strings, at most 160 characters each.
- `companyId`: exact existing tenant ID, 1-128 characters, no slash, backslash, control characters, or leading/trailing whitespace. Never accept this value from the provider's event payload.
- `secret`: a unique secret per source, 32-512 UTF-8 bytes without whitespace. Generate at least 32 random bytes, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. The example above is a placeholder, not a usable production secret. Duplicate secrets across sources are rejected to prevent cross-source replay with shared credentials.
- `streamUrl`: optional, administrator-approved public HTTPS listening URL. No userinfo/password, query string, fragment, whitespace, or backslash. Secret-bearing/signed/tokenized stream URLs are not supported. Path contents must also be public; administrators are responsible for checking that no credential is embedded in a path. Status returns `null` if omitted. This service does not fetch, proxy, or verify streams.
- Maximum 100 sources and 64 KiB of UTF-8 configuration. Unknown configuration keys, duplicate IDs/secrets, unsafe URLs, or malformed configuration disable all webhooks and expose no source metadata. Missing/empty configuration means no feeds; manual intake remains available.
- Runtime Firebase Admin credentials and the Firestore API must already be configured by the existing deployment. Environment/configuration changes, provider registration, secrets, permissions, and any deployment remain operator responsibilities.

`next.config.mjs` builds the CSP `media-src` allowlist from the HTTPS origins of configured `streamUrl` values, alongside `'self'`. Media origins are rebuilt on deployment: changes to stream origins require a new build/redeployment, not just a runtime environment update. Streams and their redirects must stay on the configured HTTPS origin (scheme, hostname, and port); off-origin redirects are not supported and can be blocked by CSP. This allowlist does not verify stream availability or provider authorization.

## Implemented Raw Body Hook

`createApp.js` already selects a dedicated `emergencyJsonParser` for requests under `/api/emergency/`, before the global application JSON parser. It enforces a **32 KiB** JSON body limit with decompression disabled (`inflate: false`). Its verification hook preserves the exact webhook bytes in **`request.rawBody`, a Buffer**, only for `/api/emergency/webhooks/`. The emergency module never reconstructs a signed body from `request.body`.

Implemented parser configuration:

```js
const emergencyJsonParser = express.json({
  limit: "32kb",
  inflate: false,
  verify(request, _response, buffer) {
    if (request.path.startsWith("/api/emergency/webhooks/")) {
      request.rawBody = Buffer.from(buffer);
    }
  }
});
```

The dedicated parser rejects oversized JSON bodies with 413 and compressed bodies with 415 before emergency route handlers execute. This applies to webhook, manual-entry, and PATCH JSON requests; these requests do not use the application's larger global JSON limit. The webhook still fails closed with 503 if its raw-body Buffer is missing. Emergency endpoints accept only uncompressed UTF-8 `application/json`; the webhook verifies the signature and then parses the authenticated bytes itself. Endpoint-level size checks and strict per-field limits remain in place as defense in depth. Apply request-rate limits upstream for resource-exhaustion protection; the parser's size limit is not a rate limiter.

## Incident Input

Used by webhook POST and manual POST. Unknown fields are errors, including nested objects where strings are required. `companyId`, provider identity, review state, contact fields, and linked records cannot be submitted as incident input.

| Field | Required | Shape and limit |
| --- | --- | --- |
| `eventId` | Yes, or `id` alias | Non-empty string, 160 characters. Stable and unique within the source. |
| `id` | No | Alias for the provider event ID, not the server document ID. If both identifiers are supplied, they must match. |
| `type` | Yes | `fire`, `water`, `storm`, `rescue`, `hazardous_material`, `other`. |
| `location` | Yes | Incident location string, 500 characters. Not a contact/person object. |
| `occurredAt` | Yes | Real UTC ISO timestamp: `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`. Stored with milliseconds. |
| `units` | No | At most 50 non-empty unit identifier strings, each at most 80 characters. Defaults to `[]`. |
| `summary` | No | Incident-only string, 2,000 characters; empty allowed. Defaults to `""`. |
| `sourceUrl` | No | Public HTTPS URL up to 2,048 characters; no credentials, query, fragment, whitespace, or backslash. Defaults to `null` in output; omit from input when unavailable. |

Strings are trimmed; invalid values are rejected, not silently truncated. Calendar-invalid dates, arrays at the top level, unsupported enums, and unexpected keys are rejected. This is schema validation, not an automatic PII detector: the provider/operator must keep personal information out of free text. No external contact or enrichment service is called.

## Webhook Contract and Signed Sample

`POST /api/emergency/webhooks/:sourceId`

- `Content-Type: application/json`
- `x-emergency-timestamp`: canonical Unix **seconds**, 10 decimal digits, within 300 seconds of server time in either direction (inclusive).
- `x-emergency-signature`: `sha256=` followed by the 64 hexadecimal characters of HMAC-SHA256 using the source secret.
- Signed message: the timestamp header verbatim, one ASCII `.`, then the exact UTF-8 request body bytes. No URL/path, newline suffix, reserialization, or base64 digest.
- Query parameters are not supported. No session cookie is required or used as webhook authentication.

Example Node.js sender, run only against an intentionally configured development/test source:

```js
const crypto = require("node:crypto");

async function sendIncident() {
  const sourceId = "county-dispatch";
  const secret = process.env.EMERGENCY_SOURCE_SECRET;
  if (!secret) throw new Error("Set the source-specific test secret securely.");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify({
    eventId: "provider-test-event-0001",
    type: "fire",
    location: "100 Example Street",
    occurredAt: new Date().toISOString(),
    units: ["Engine 1"],
    summary: "Provider integration test, not an active emergency."
  }), "utf8");
  const signature = crypto.createHmac("sha256", secret)
    .update(timestamp).update(".").update(rawBody).digest("hex");
  const response = await fetch(`http://localhost:3000/api/emergency/webhooks/${sourceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-emergency-timestamp": timestamp,
      "x-emergency-signature": `sha256=${signature}`
    },
    body: rawBody
  });
  console.log(response.status, await response.json());
}

sendIncident().catch(console.error);
```

Use HTTPS outside localhost. For a retry, reuse the identical incident payload and event ID, but generate a fresh timestamp/signature if necessary; in particular, do not change `occurredAt` on retry. New incident: **201** `{ "success": true, "id": "<64 lowercase hex characters>", "duplicate": false }`. Identical normalized retry: **200** with the same ID and `duplicate: true`. Reusing an ID with different incident data: **409**, with no overwrite. A replay outside the clock window is **401**, even for an existing event.

## Office Endpoints

### GET /api/emergency/status

No query parameters. Authorized callers receive only sources assigned to their own tenant:

```json
{
  "success": true,
  "configured": true,
  "configurationValid": true,
  "sources": [
    { "id": "county-dispatch", "label": "County Dispatch", "area": "Example County", "streamUrl": "https://authorized-provider.example/listen" }
  ],
  "runtime": { "storage": "firestore", "available": true, "reason": null },
  "webhookReady": true,
  "incidentTypes": ["fire", "water", "storm", "rescue", "hazardous_material", "other"],
  "reviewStatuses": ["new", "reviewed", "linked", "dismissed"],
  "limits": { "payloadBytes": 32768, "maxIncidents": 100, "timestampSkewSeconds": 300 }
}
```

`runtime.available` reflects a bounded read of the caller's incident collection. Failure returns `available: false`, `reason: "storage_unavailable"`. `webhookReady` means valid configured tenant sources plus a successful datastore probe. It does **not** prove provider delivery, parser-hook installation, transaction write permission, stream availability, or live connectivity. No provider heartbeat is fabricated. Missing configuration returns `configured: false`, `configurationValid: true`, `sources: []`. Invalid configuration returns `configurationValid: false`, `sources: []`. Status itself returns 200 for these states after authorization; existing session validation can independently fail with 401/403/503.

### GET /api/emergency/incidents?limit=50

`limit` is the only supported query parameter: decimal integer 1-100, default 50. Results are latest-first by server `receivedAt`; the Firestore query itself is limited, not a global read followed by in-memory truncation. This endpoint is a bounded recent-events view, not an unbounded export/pagination API.

```json
{
  "success": true,
  "limit": 50,
  "incidents": [
    {
      "id": "<64 lowercase hex characters>",
      "eventId": "provider-event-123",
      "type": "fire",
      "location": "100 Example Street",
      "occurredAt": "2026-09-19T13:59:00.000Z",
      "units": ["Engine 1"],
      "summary": "Structure fire reported.",
      "sourceUrl": null,
      "sourceId": "county-dispatch",
      "sourceLabel": "County Dispatch",
      "area": "Example County",
      "ingestion": "webhook",
      "reviewStatus": "new",
      "linkedRecordId": null,
      "receivedAt": "2026-09-19T14:00:00.000Z",
      "createdAt": "2026-09-19T14:00:00.000Z",
      "updatedAt": "2026-09-19T14:00:00.000Z"
    }
  ]
}
```

### POST /api/emergency/incidents

Same incident input and idempotency rules as webhook intake, but requires an authorized office session. Use a stable client-generated event ID, such as a UUID, for retries. The server supplies `sourceId: "_manual"`, `sourceLabel: "Manual entry"`, `area: ""`, `ingestion: "manual"`. No provider configuration is needed. Returns **201**, or **200** for a duplicate: `{ "success": true, "id": "...", "duplicate": false, "incident": { ... } }`.

### PATCH /api/emergency/incidents/:id

Only `reviewStatus` and `linkedRecordId` are accepted; at least one is required. The path ID is the server's 64-character lowercase hex ID, not the provider event ID. Review enum: `new`, `reviewed`, `linked`, `dismissed`. `reviewed` indicates completed human review. `linkedRecordId` is `null` or a 1-160-character identifier starting with an ASCII letter/digit and containing only letters/digits/underscore/dot/colon/hyphen.

Workflow:

1. After completing human review, PATCH `{ "reviewStatus": "reviewed" }` before linking.
2. Create the dispatch `moduleRecords` entry and its file through the existing workspace PUT. Set `moduleKey: "dispatch"` and `sourceIncidentId` to this emergency incident's server ID. Wait for successful persistence. Any user-selected CRM contact stays in the existing authorized workspace flow, not in emergency intake.
3. PATCH `{ "reviewStatus": "linked", "linkedRecordId": "<moduleRecord.id>" }`.

Inside the same Firestore transaction as the incident update, a first link requires the stored `reviewStatus` to be `reviewed`; linking directly from `new` or `dismissed` returns **409**, even with a valid target. The backend then requires exactly one active `osWorkspaceRecords` target with matching session `companyId`, `field: "moduleRecords"`, `recordId` and `data.id` equal to `linkedRecordId`, `deletedAt: ""`, `data.moduleKey: "dispatch"`, and `data.sourceIncidentId` equal to the incident ID. Missing, foreign-tenant, ambiguous, deleted, wrong-module, or wrong-incident targets are rejected without updating the incident. No linked record is read without a company restriction; the target query is capped at two documents to reject ambiguity.

Linking is **immutable**: after status becomes `linked`, changing its status or linked ID, including clearing it, returns **409**. Identical retries return the existing incident with **200** and no write. Racing attempts to link different records have one winner. Use deterministic workspace IDs and handle 409 by reloading the incident: workspace creation and incident linking are separate requests, so the backend cannot prevent orphan workspace records created by a losing client before it submits PATCH. The link does not grant authorization to read the target record.

All successful PATCH responses: `{ "success": true, "incident": { ... } }`. Incident fields, source attribution, event ID, and company cannot be edited by PATCH.

## Persistence, Errors, and Operations

- Storage path: `osEmergencyCompanies/{sha256(companyId)}/incidents/{sha256(JSON.stringify([sourceId,eventId]))}`. Hashes are lowercase hex. The tenant scope is derived only from authenticated server state or provider configuration.
- First-write detection and insertion share a Firestore transaction. A normalized incident hash detects conflicting reuse of IDs. Retries preserve the original record and all office decisions. Review writes record the authenticated user UID and server update time; internal hashes/UIDs and unexpected stored fields are not returned in public incident responses.
- Default `receivedAt` indexing is required for the recent-events query. Linking uses equality filters on `osWorkspaceRecords.companyId`, `field`, `recordId`, and `deletedAt`. Keep those fields indexed and verify the query in your target Firebase project before enabling provider traffic. No index/rules/deployment files are changed here.
- Retain incident documents for the required retry/idempotency horizon. Deleting them also removes the durable deduplication record. There is intentionally no HTTP delete endpoint.
- Errors use `{ "success": false, "message": "..." }`: 400 validation/invalid link, 401 authentication/signature/replay, 403 role/module/company/browser-origin denial, 404 incident not found within the tenant, 409 ID conflict or immutable-link conflict, 413 oversized body, 415 unsupported encoding/content type, 503 configuration/raw-body/storage unavailable. The app's outer parser can reject a request before these handlers run.
- Do not render incident strings as HTML. Only authorized status responses expose configured stream URLs. No raw signatures, provider secrets, or raw payloads are stored by this module.
- Apply provider/edge request-rate limits and monitoring outside these routes; no process-local rate limiter is represented as durable protection. Alert on repeated signature failures, storage failures, configuration errors, and provider-delivery silence using operational tooling. Provider polling, subscriptions, credentials, usage rights, adapters for provider-specific payloads/signatures, stream playback permissions, and retry delivery remain external requirements.

## Verification

```powershell
node node_modules/vitest/vitest.mjs run tests/emergency-response.test.js
node node_modules/vitest/vitest.mjs run tests
```

Tests exercise real Express routing and the existing Firebase router, with fake Auth/Firestore implementations. They cover malformed signatures, clock-window replay, tampering, exact-byte authentication, concurrent duplicates, failed persistence, payload/configuration validation, forbidden contact fields, roles/module visibility, tenant-scoped reads/writes, safe status metadata, bounds, dispatch target validation, and racing immutable links. They do not replace a Firestore emulator/staging test of IAM, indexes, transaction contention, or a real provider delivery. No production credentials, external incident feeds, deployment, or commits are needed for the test suite.

Implementation references: [Express JSON parser verification](https://expressjs.com/en/5x/api.html#express.json), [Node.js HMAC and timing-safe comparison](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b), [Firestore atomic transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firestore transactional document/query reads](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/transaction).
