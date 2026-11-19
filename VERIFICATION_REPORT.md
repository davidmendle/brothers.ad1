# Brothers OS Workflow Verification

Date: 2026-11-19. Repository: `davidmendle/brothers.ad1`. Production project: `brothers-ad`, Brothers Restoration Services.

## November 19 Refinement

- Team, invitation, profile and access-management forms preserve drafts on rejected requests, including the exact selected checkboxes, radio options and multi-select values. Existing disabled controls remain disabled after completion.
- Committed invitations remain visible when a subsequent directory refresh fails. The UI distinguishes the committed invitation from an ancillary workspace-file failure, so users are not told to recreate an already issued link.
- Tasks and their support files persist before employee assignment updates. Partial assignment failures retain a pending-sync marker and a retry action that repairs the same task, including after reload; completion retries do not duplicate history.
- Accepting an employee invitation atomically converts its matching task and assignment-file identities to the verified Firebase UID, activates the grant/user, and advances the workspace revision. Task/file IDs, history and evidence references remain intact. Cross-company, employer, email and explicit franchise mismatches are excluded. Conflicts and the 450-write limit abort activation without consuming the invitation.
- A task retry can also resolve a pending invitation identity to an accepted employee using the exact active grant and matching account scope, without creating another task or evidence file.
- Current server invitations take precedence over stale browser profiles. Revoked and superseded invitations cannot reappear from cached team members. Disabled and expired pending profiles are not assignable.
- Team job suggestions use scoped visible jobs. Task assignment validates employer identity and unambiguous job references, and carries the canonical job ID into linked records.
- Newly submitted empty module selections are rejected by both UI and managed-user/access-grant APIs, rather than accidentally reverting to role defaults. Legacy empty lists retain their documented default semantics; explicit deny-all permission overrides remain distinct. Disabling an account removes access.
- Login and existing-session checks require `email_verified === true` in addition to the allowed provider and existing Firebase verification. Missing, false, null and nonboolean verification claims are rejected before account storage or cookie creation.
- The Next script preload now uses the same CORS mode as its module fetch, eliminating a duplicate `/app.js` download without changing authentication or private-data caching.

### Performance Evidence

Three controlled cold-load comparisons against the same frozen asset snapshot reduced `/app.js` requests from two to one. Compressed JavaScript/CSS body bytes decreased from 334,343 to 187,257 (44.0%). This is fixture transfer evidence, not a production latency or throughput claim.

Separate checks against the actual Next production build at 1440x900 and 390x844 confirmed one `/app.js` request per viewport, 147,745 encoded body bytes for that build, normal Next hydration, no page/hydration errors and no horizontal overflow. Authentication responses and Firebase SDK imports were locally stubbed; Google OAuth was not performed. The sign-in gate, shield logo and Google button were visually reviewed in both screenshots. Repeated shield requests remain observable with interception disabling normal HTTP caching.

### Skill Review

Applicable Vercel deployment/verification and skill-review guidance was used. The official Hugging Face `hf-cli` skill was downloaded for read-only review at commit `5291c2b9365e06b175dc04817610c778623f4836`, outside the checkout and auto-load directories. It was not installed or executed. Its mutable remote installer and external binaries remain outside that review; no models, paid jobs, or unrelated dependencies were added to the application.

## Repairs

- Pricing imports use local PDF.js and fflate libraries for selectable-text PDFs and ZIP/ESX containers. CSV, TSV, supported XML and text rows are validated before import. Partial imports require explicit review; unsupported, scanned, malformed, oversized or ambiguous files are not reported as imported.
- Manual office time selects a saved employee and exact saved job, calculates net hours after breaks, records the administrator audit, and creates linked job/billing evidence. Manual entries never manufacture GPS evidence.
- New jobs select an employer profile matching employee invitations. Job tasks and support files retain ownership instead of becoming unrelated records. Existing jobs are not automatically reassigned.
- Dispatch creation focuses the structured form and awaits a shared-storage acknowledgment. Rejected saves retain the form draft.
- Equipment placement, return, rental duration, office billing review and invoice creation share the same record identity. Active assets cannot be deployed twice in the same company/contractor inventory. Field users cannot forge billing fields.
- Equipment controls remain disabled until the shared save and form refresh finish, preventing the next edit from being overwritten by a delayed acknowledgment. Failure paths restore the prior control state.
- Job summaries show assigned work, recorded hours and equipment still out. Pickup requests remain active until a return is recorded.
- Server validation rejects inconsistent job references and unauthorized contractor/franchise scope. Unchanged historical records can round-trip without retroactively rewriting their history.
- Employee writes inherit the exact scope of persisted, authorized assignments, including branch-only jobs; unknown assignments and mismatched scope are rejected. New job/task forms wait for server acknowledgment before reporting success.
- Dependency patches and CI updates use Node 24, the frozen pnpm lockfile, and Chromium-backed tests.

## Evidence

| Check | Result |
| --- | --- |
| Full unit/router suite | 684 tests passed across 27 files (`pnpm test`, November 19). A concurrent-browser run previously hit two cleanup timeouts; the subsequent standalone full run passed completely. |
| Next.js production build | Passed (`pnpm build`, Next.js 16.4.6). Nonblocking mixed-module/Express static-analysis warnings remain; local blog rendering falls back when Firebase is absent. |
| Real local API authentication | Unauthenticated `/api/workspace-state` and `/api/rbac/context` requests returned HTTP 401 with no workspace data. |
| Prior browser workflow | The November 18 run covered 70 modules, 81 action types, 49 form types and 13 field controls; 43 screenshots were captured. The expanded November 19 run is recorded separately below when complete. |
| Expanded browser workflow, local diagnostic | Reached 70 modules, 47 workbench submissions, 217 checks and 57 screenshots, with zero unexpected console/HTTP failures. Stopped at a team-lifecycle quiescence timeout; final coverage counters were not completed. The final production build passed, but the local preview restart was blocked by the execution policy, so a complete local rerun is not claimed. |
| Rejected saves and mobile layout | Eight rejected-save checks retained drafts without false success. Linked workflows and reload checks passed. The mobile time clock fits a 390px viewport; its wide table scrolls internally. |
| Delayed equipment acknowledgment | An accepted write was held before its response. Equipment inputs remained disabled until the fresh UI acknowledgment; the next rate edit retained the same invoice ID and updated two days at $100 to $200. |
| Production HTTP | `https://brothers.ad/api/health` returned HTTP 402 with `X-Vercel-Error: DEPLOYMENT_DISABLED`. |
| Production Firebase Admin | Required Admin/OIDC credentials were absent in Vercel environment-key inspection. Google Cloud requires account-owner reauthentication before configuration can be verified. |
| Production dependency audit | No critical/high/low findings; two moderate transitive findings remain in optional Firebase/Google dependencies (`glob` and `minimatch`). |

Browser screenshots and detailed run output are in ignored local `logs/`; these are test artifacts, not customer records. Browser API interception is explicitly labeled in the smoke report and does not establish production database, Google OAuth, email or payment-provider success. Router tests use an in-memory Firestore fixture.

Coverage counts refer to distinct action/form/control types, not proof that every possible button instance, permission combination or customer dataset works. An earlier development smoke run failed to find an assigned photo task; this did not recur in the successful local verification runs. Real employee photo uploads remain a production acceptance check.

## Release Limits

Production is not certified ready. Account activation, Google Cloud access, Firebase Admin read/write health, real owner sign-in, invited employee sign-in, denied unauthorized sign-in, and live persistence across separate devices still require verification. No passwords, authenticator seeds or service-account private keys belong in this repository or chat.

The invitation-identity migration runs during acceptance. Already-activated production accounts have not been inspected or backfilled. Any old invitation-ID tasks on those accounts require an evidence-backed repair after database access is available; no live customer records were changed in these tests.

Email invitation delivery requires a configured, verified provider. A generated link is not proof that email was delivered. Google login alone is not proof of enforced application-level two-factor authentication.

Pricing extraction is not a complete proprietary Xactimate ESX interpreter or OCR engine. The existing highest-rate price-book policy remains unchanged. Source quantities are retained; line totals are not substituted for unit rates. Real customer exports still need a representative acceptance test.

Workspace limits remain explicit: 2,500 records per array, 3 MB per request and the existing transaction write cap. No large-scale load test, legal/franchise determination or claim of market-leading completeness is made by this report.

## Release Attempt

### November 19

The refinement code was pushed as commit `2fef8daa648025199b3ba4642a917057c1da3f13` to `fix/team-onboarding-20261119`. The work is not merged into `main`. Creating a draft pull request through the connected GitHub integration returned HTTP 403, `Resource not accessible by integration`; no alternate identity or permission bypass was attempted. The normal pull-request verification workflow has therefore not run for this refinement. Its browser gate must pass before promotion.

Vercel's `brothers-ad` status check for this commit failed with an account-deployment-blocked link. At 2026-11-19 22:10 UTC, `https://brothers.ad/api/health` still returned HTTP 402 and `X-Vercel-Error: DEPLOYMENT_DISABLED`. No successful live release is claimed. The billing, Google Cloud reauthentication and Firebase Admin configuration checks above remain unresolved.

### November 18

The repairs were pushed to GitHub `main` as commit `389dbda3078bf4bc82820f0e1f137aba40e128d4`. A production deployment request for the verified `brothers-ad` project and Brothers Restoration Services team was rejected on 2026-11-18 with HTTP 402 `resource_creation_blocked`: Vercel reported the account suspended and required a valid payment method. No new production deployment was created. The custom domain still returned `DEPLOYMENT_DISABLED`.

The first GitHub Actions run stopped during browser installation: `ubuntu-latest` selected Ubuntu 26.04, unsupported by the pinned Playwright 1.55.1. The workflow is now pinned to supported Ubuntu 24.04; application tests were not removed or weakened. Remote CI results are available in the repository's Actions history.

The first Ubuntu 24.04 run passed its 574 unit/router tests and production build, then exposed an invoice-edit timing failure in the browser workflow. Equipment controls now remain locked through acknowledgment and rendering. Two additional unit tests and a deterministic delayed-response browser regression cover the correction; final remote rerun status is recorded in GitHub Actions.

## Sources

- [Vercel deployment-disabled diagnosis](https://vercel.com/docs/errors/deployment_disabled)
- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp)
- [PDF.js](https://github.com/mozilla/pdf.js)
- [fflate](https://github.com/101arrowz/fflate)
- [Remaining glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [Remaining minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [CORS settings and same-origin credentials](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin)
- [Official Hugging Face skills catalog](https://huggingface.co/docs/hub/agents-skills)
