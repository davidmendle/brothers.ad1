# Firebase Auth and RBAC Setup

This OS keeps the existing frontend and Express backend, then layers Firebase Authentication, Firestore-backed RBAC, admin edit mode, and audit logging on top.

## Required environment variables

Backend Firebase Admin:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Alternative backend credential sources:

- `FIREBASE_SERVICE_ACCOUNT_JSON` as a file path or raw JSON string
- `GOOGLE_APPLICATION_CREDENTIALS` when the environment already has Google ADC configured

Recommended local private file path for this repo:

- `.secrets/serviceAccountKey.json`
- Put `FIREBASE_SERVICE_ACCOUNT_JSON=.secrets/serviceAccountKey.json` in `.env.local` or `.secrets/firebase-admin.env`

Frontend Firebase Web SDK:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_APP_ID`
- `FIREBASE_MESSAGING_SENDER_ID`

Optional:

- `SUPER_ADMIN_EMAILS`
- `FIREBASE_OWNER_ONLY_LOGIN`
- `FIREBASE_ALLOWED_LOGIN_EMAILS`
- `FIREBASE_SESSION_TTL_MS`
- `FIREBASE_ALLOWED_SIGN_IN_PROVIDERS`
- `FIREBASE_STORAGE_BUCKET`
- `RESEND_API_KEY`
- `INVITE_FROM_EMAIL`
- `INVITE_REPLY_TO_EMAIL`

Recommended for this Brothers OS deployment:

- `SUPER_ADMIN_EMAILS=david@brothersrestoration.org`
- `FIREBASE_OWNER_ONLY_LOGIN=true`
- `FIREBASE_ALLOWED_LOGIN_EMAILS=david@brothersrestoration.org`
- `BLOCKED_ADMIN_EMAILS=chaim@brothersrestoration.org,reznikchaim@gmail.com`
- `FIREBASE_SESSION_TTL_MS=172800000`
- `FIREBASE_ALLOWED_SIGN_IN_PROVIDERS=google.com`
- `RESEND_API_KEY=re_xxxxxxxxx`
- `INVITE_FROM_EMAIL="Brothers OS <access@yourdomain.com>"`
- Keep Google as the enabled sign-in provider in Firebase Authentication. Add `password` to `FIREBASE_ALLOWED_SIGN_IN_PROVIDERS` only for a controlled super-admin fallback.
- Configure Resend and `INVITE_FROM_EMAIL` if Super Admin should email invite links and individual access codes directly from the Admin Access page.

Live Firebase console findings from June 18, 2026:

- Project ID: `brothers-restoration-website`
- Browser SDK imports use Firebase JS SDK `12.15.0`
- The Firebase console's npm snippet uses bare imports such as `firebase/app`; this static Vercel app uses the equivalent browser ESM URLs from `https://www.gstatic.com/firebasejs/12.15.0/` because it does not run a frontend bundler
- Web app config:
  - `apiKey`: copy from Firebase Console into the private Vercel environment only.
  - `authDomain`: `brothers-restoration-website.firebaseapp.com`
  - `storageBucket`: `brothers-restoration-website.firebasestorage.app`
  - `messagingSenderId`: `80592032671`
  - `appId`: `1:80592032671:web:a4a236c46dda1eb12263aa`
  - `measurementId`: `G-6Q0QNW5P10`
- Google sign-in provider is enabled
- Existing Auth users should be reviewed in Firebase Authentication, and any revoked users should be disabled there.
- Firestore already contains legacy `admins`, `pages`, `settings`, and related collections, so the OS layer should preserve compatibility rather than treat Firestore as empty
- Firebase Admin SDK credentials are still required in Vercel before the hosted OS can verify Google ID tokens and unlock protected data

## Collections

Because this Firebase project may already use public website collections such as `pages` and `settings`, the OS stores its protected RBAC data in namespaced collections to avoid breaking the live site.

- `osUsers`
  - `uid`
  - `email`
  - `displayName`
  - `roleId`
  - `disabled`
  - `companyId`
  - `franchiseIds`
  - `contractorId`
  - `accessGrantId`
  - `accessCodeId`
  - `accessExpiresAt`
  - `accessScope`
  - `assignedTaskIds`
  - `permissionsOverride`
  - `visibleTabIds`
  - `visiblePageIds`
  - `sectionOverrides`
  - `status`
  - `createdAt`
  - `updatedAt`

- `osRoles`
  - `id`
  - `label`
  - `rank`
  - `description`
  - `system`

- `osPermissions`
  - `roleId`
  - `tabs`
  - `pages`
  - `sections`
  - `actions`
  - `dataAccess`
  - `updatedAt`

- `osTabs`
  - `id`
  - `key`
  - `pageId`
  - `label`
  - `visible`
  - `order`
  - `category`
  - `purpose`

- `osPages`
  - `id`
  - `tabId`
  - `routeKey`
  - `title`
  - `purpose`
  - `visible`
  - `order`

- `osPageSections`
  - `id`
  - `pageId`
  - `moduleKey`
  - `title`
  - `visible`
  - `order`
  - `imageUrl`
  - `content.heading`
  - `content.body`
  - `content.buttons`

- `osCompanySettings`
  - `id`
  - `brandName`
  - `brandLogoUrl`
  - `editModeEnabled`
  - `allowUserSelfService`

- `osFranchiseSettings`
  - `id`
  - `displayName`
  - `visible`

- `osAuditLogs`
  - `actorUid`
  - `actorRoleId`
  - `eventType`
  - `targetType`
  - `targetId`
  - `metadata`
  - `createdAt`

- `osAccessRequests`
  - public login-dashboard requests for 48-hour access
  - `email`
  - `displayName`
  - `companyName`
  - `requestedRole`
  - `status`
  - `requestedAt`
  - `expiresAt`

- `osAccessGrants`
  - Super Admin issued access links and hashed contractor codes
  - `email`
  - `roleId`
  - `contractorId`
  - `tokenHash`
  - `portalCodeHash`
  - `expiresAt`
  - `status`

- `osBusinessRecords`
  - scoped customer, revenue invoice, and contractor invoice records
  - `type`
  - `companyId`
  - `franchiseId`
  - `contractorId`
  - `amount`
  - `balance`
  - `status`

- `osCommunityPosts`
  - contractor discussion board posts and comments
  - `title`
  - `body`
  - `tags`
  - `authorUid`
  - `authorEmail`
  - `comments`

## Roles

- `super_admin`
  - Full system access.
- `business_owner`
  - Company-level reporting, users, franchise visibility, and settings if allowed.
- `franchise_owner`
  - Franchise-scoped workers, jobs, reports, and settings.
- `contractor`
  - Contractor portal access to assigned jobs, own contractor invoices, and the communication board.
- `worker`
  - Assigned tasks, allowed field tools, and scoped job/time visibility.

## Admin features

The **Admin Access** module at `#module/accessadmin` exposes the Super Admin tools directly. The Team module also shows the same controls when the signed-in role has the required permissions.

- Firebase user creation
- Role permission editing
- User disable/enable
- User delete
- User permission reset
- Audit log visibility
- 48-hour access request approval
- Contractor access link and access code issuing
- Email invite sending with the access link, access code, expiration, and Google sign-in instructions
- Customer, revenue invoice, and contractor invoice visibility according to role scope
- Communication board visibility and moderation
- Admin edit overlay for tabs, pages, sections, buttons, and images

The **Contractor Portal** module at `#module/contractorportal` is the contractor-first workspace for assigned jobs, invoice status, field documentation, access state, and communication-board activity.

The **Global Indexes** module at `#module/globalindexes` is intentionally Super Admin-only. Contractors, workers, and scoped owner roles do not receive that module in their role-filtered navigation.

## Hosted login behavior

The hosted OS is locked by default. Opening the Vercel link shows the authentication screen until a valid Firebase OS session exists.

- Google sign-in is the default and only visible provider when `FIREBASE_ALLOWED_SIGN_IN_PROVIDERS=google.com`.
- Owner-only login is enforced when `FIREBASE_OWNER_ONLY_LOGIN=true`; only `david@brothersrestoration.org` can establish a hosted OS session when `FIREBASE_ALLOWED_LOGIN_EMAILS=david@brothersrestoration.org`.
- If Firebase env vars are missing, the app shows an authentication setup blocker instead of opening the platform.
- Super Admin is assigned by adding your Google email to `SUPER_ADMIN_EMAILS`.
- After Super Admin login, open `#module/accessadmin` to manage user logins and send contractor invites.

## Invite workflow

1. Sign in with `david@brothersrestoration.org`.
2. Open `#module/accessadmin`.
3. In **User Login Manager**, use **Send invite**.
4. Enter the contractor's Google email, role, contractor id, and access duration.
5. Keep **Send invite email** checked.
6. Submit the form.

The server creates a 48-hour single-email access grant, generates an individual access code, sends both by email through Resend when configured, and also shows the one-time link/code on screen for manual backup.

## API surface

- `GET /api/auth/config`
- `POST /api/auth/session/login`
- `POST /api/auth/session/logout`
- `GET /api/auth/session`
- `POST /api/access/trial-request`
- `GET /api/access/requests`
- `POST /api/access/grants`
- `GET /api/business-data`
- `GET /api/community/posts`
- `POST /api/community/posts`
- `POST /api/community/posts/:postId/comments`
- `PATCH /api/community/posts/:postId`
- `GET /api/rbac/context`
- `GET /api/rbac/users`
- `POST /api/rbac/users`
- `PATCH /api/rbac/users/:uid`
- `POST /api/rbac/users/:uid/reset-permissions`
- `DELETE /api/rbac/users/:uid`
- `GET /api/rbac/roles`
- `PATCH /api/rbac/permissions/:roleId`
- `POST /api/rbac/permissions/:roleId/reset`
- `PATCH /api/rbac/tabs/:id`
- `PATCH /api/rbac/pages/:id`
- `PATCH /api/rbac/page-sections/:id`
- `PATCH /api/rbac/company-settings/default`
- `PATCH /api/rbac/franchise-settings/:id`
- `GET /api/rbac/audit-logs`
- `POST /api/rbac/assets`

## Verification checklist

- Set all Firebase env vars.
- Set `FIREBASE_OWNER_ONLY_LOGIN=true`.
- Set `FIREBASE_ALLOWED_LOGIN_EMAILS=david@brothersrestoration.org`.
- Set `SUPER_ADMIN_EMAILS=david@brothersrestoration.org`.
- Set `BLOCKED_ADMIN_EMAILS=chaim@brothersrestoration.org,reznikchaim@gmail.com`.
- Confirm Google sign-in is enabled in Firebase Authentication for the live project.
- Confirm `brothers.ad` and `www.brothers.ad` are authorized in Firebase Authentication.
- Sign in through the Firebase login screen.
- Submit a trial request from the login dashboard and verify it lands in `osAccessRequests`.
- As Super Admin, issue a 48-hour access grant and verify the generated access link and contractor code are shown once.
- Sign in with the exact Google email on the access link and verify access expires after 48 hours.
- Confirm `GET /api/auth/session` returns role, permissions, tabs, pages, sections, users, and settings.
- Confirm Super Admin sees all `osBusinessRecords`; contractor only sees their own contractor invoices.
- Confirm non-Super-Admin roles cannot see global indexes/source vaults.
- Confirm a contractor lands on or can open `#module/contractorportal` and sees only scoped jobs, tasks, invoices, and board activity.
- Create a communication-board post and comment as a contractor.
- Confirm live website collections such as `pages`, `settings`, `services`, `leads`, and `admins` still behave as before after rules deployment.
- Create a Business Owner, Franchise Owner, and Worker.
- Confirm each role sees different tabs and module access.
- Confirm Worker only sees assigned tasks/jobs/time entries.
- Change a role permission and verify the UI updates after refresh.
- Open Admin Edit Mode, rename a tab/page/section, and verify the change is saved to Firestore.
- Upload a section image and verify the stored URL is reused by the UI.
- Confirm `auditLogs` receives user, permission, and page-change events.
- Deploy `firestore.rules` to Firebase and validate blocked writes from unauthorized accounts.
