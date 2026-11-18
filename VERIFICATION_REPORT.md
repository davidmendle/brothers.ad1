# Brothers OS Workflow Verification

Date: 2026-11-18. Repository: `davidmendle/brothers.ad1`. Production project: `brothers-ad`, Brothers Restoration Services.

## Repairs

- Pricing imports use local PDF.js and fflate libraries for selectable-text PDFs and ZIP/ESX containers. CSV, TSV, supported XML and text rows are validated before import. Partial imports require explicit review; unsupported, scanned, malformed, oversized or ambiguous files are not reported as imported.
- Manual office time selects a saved employee and exact saved job, calculates net hours after breaks, records the administrator audit, and creates linked job/billing evidence. Manual entries never manufacture GPS evidence.
- New jobs select an employer profile matching employee invitations. Job tasks and support files retain ownership instead of becoming unrelated records. Existing jobs are not automatically reassigned.
- Dispatch creation focuses the structured form and awaits a shared-storage acknowledgment. Rejected saves retain the form draft.
- Equipment placement, return, rental duration, office billing review and invoice creation share the same record identity. Active assets cannot be deployed twice in the same company/contractor inventory. Field users cannot forge billing fields.
- Job summaries show assigned work, recorded hours and equipment still out. Pickup requests remain active until a return is recorded.
- Server validation rejects inconsistent job references and unauthorized contractor/franchise scope. Unchanged historical records can round-trip without retroactively rewriting their history.
- Employee writes inherit the exact scope of persisted, authorized assignments, including branch-only jobs; unknown assignments and mismatched scope are rejected. New job/task forms wait for server acknowledgment before reporting success.
- Dependency patches and CI updates use Node 24, the frozen pnpm lockfile, and Chromium-backed tests.

## Evidence

| Check | Result |
| --- | --- |
| Full unit/router suite | 574 tests passed across 23 files (`pnpm test`). |
| Next.js production build | Passed (`pnpm build`, Next.js 16.4.6). Nonblocking mixed-module/Express static-analysis warnings remain; local blog rendering falls back when Firebase is absent. |
| Real local API authentication | Unauthenticated `/api/workspace-state` and `/api/rbac/context` requests returned HTTP 401 with no workspace data. |
| Browser workflow | Two final successful runs, including an independent repeat against the local production build. Each covered 70 modules, 81 action types, 49 form types and 13 field controls; 41 screenshots were captured per run. No unexpected browser errors or failed responses were recorded. |
| Rejected saves and mobile layout | Eight rejected-save checks retained drafts without false success. Linked workflows and reload checks passed. The mobile time clock fits a 390px viewport; its wide table scrolls internally. |
| Production HTTP | `https://brothers.ad/api/health` returned HTTP 402 with `X-Vercel-Error: DEPLOYMENT_DISABLED`. |
| Production Firebase Admin | Required Admin/OIDC credentials were absent in Vercel environment-key inspection. Google Cloud requires account-owner reauthentication before configuration can be verified. |
| Production dependency audit | No critical/high/low findings; two moderate transitive findings remain in optional Firebase/Google dependencies (`glob` and `minimatch`). |

Browser screenshots and detailed run output are in ignored local `logs/`; these are test artifacts, not customer records. Browser API interception is explicitly labeled in the smoke report and does not establish production database, Google OAuth, email or payment-provider success. Router tests use an in-memory Firestore fixture.

Coverage counts refer to distinct action/form/control types, not proof that every possible button instance, permission combination or customer dataset works. An earlier development smoke run failed to find an assigned photo task; this did not recur in either final run. Real employee photo uploads remain a production acceptance check.

## Release Limits

Production is not certified ready. Account activation, Google Cloud access, Firebase Admin read/write health, real owner sign-in, invited employee sign-in, denied unauthorized sign-in, and live persistence across separate devices still require verification. No passwords, authenticator seeds or service-account private keys belong in this repository or chat.

Email invitation delivery requires a configured, verified provider. A generated link is not proof that email was delivered. Google login alone is not proof of enforced application-level two-factor authentication.

Pricing extraction is not a complete proprietary Xactimate ESX interpreter or OCR engine. The existing highest-rate price-book policy remains unchanged. Source quantities are retained; line totals are not substituted for unit rates. Real customer exports still need a representative acceptance test.

Workspace limits remain explicit: 2,500 records per array, 3 MB per request and the existing transaction write cap. No large-scale load test, legal/franchise determination or claim of market-leading completeness is made by this report.

## Sources

- [Vercel deployment-disabled diagnosis](https://vercel.com/docs/errors/deployment_disabled)
- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp)
- [PDF.js](https://github.com/mozilla/pdf.js)
- [fflate](https://github.com/101arrowz/fflate)
- [Remaining glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [Remaining minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
