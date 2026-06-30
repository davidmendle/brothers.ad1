# brothers.ad Launch Checklist

Target live OS domain:

```text
https://brothers.ad
```

Current DNS checks from this workspace:

```text
brothers.ad      A      76.76.21.21
www.brothers.ad  CNAME  cname.vercel-dns.com
```

That DNS points at Vercel. The remaining launch work is in the Vercel project and Firebase console.

## Vercel project

In the Vercel project that currently serves `updated-ui-brs-site.vercel.app`:

1. Open Settings, then Domains.
2. Add `brothers.ad`.
3. Add `www.brothers.ad`.
4. Set the preferred production domain to `brothers.ad`.
5. Configure `www.brothers.ad` to redirect to `brothers.ad`.
6. Wait for Vercel to mark the domains as valid and issue SSL.
7. Redeploy the latest production build.

The code now defaults public OS URLs to:

```text
OS_BASE_URL=https://brothers.ad
```

The OS also includes a Super Admin `Launch Center` module that shows domain, DNS, Firebase Web, Firebase Admin, Google login, and final smoke-test readiness in the interface.

The old Vercel hostname remains a legacy alias only and should not be the primary public OS URL.

## Vercel environment variables

Set or confirm these production variables:

```text
OS_BASE_URL=https://brothers.ad
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_ALLOWED_SIGN_IN_PROVIDERS=google.com
FIREBASE_SESSION_TTL_MS=172800000
SUPER_ADMIN_EMAILS=david@brothersrestoration.org
BLOCKED_ADMIN_EMAILS=chaim@brothersrestoration.org,reznikchaim@gmail.com
```

If you do not use `FIREBASE_SERVICE_ACCOUNT_JSON`, set these instead:

```text
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

The Firebase web config for `brothers-restoration-website` is already wired into the app defaults.

Keep `ENABLE_LEGACY_PROXY`, `ENABLE_LEGACY_ADMIN_PROXY`, `ALLOW_LEGACY_ADMIN_BRIDGE`, and `ALLOW_DERIVED_ADMIN_FALLBACK` unset in production unless you are intentionally testing a temporary migration bridge.

## Firebase Authentication

In Firebase Console, open Authentication, then Settings, then Authorized domains.

Add:

```text
brothers.ad
www.brothers.ad
```

Keep Google as an enabled sign-in provider.

## Post-launch smoke test

1. Visit `https://brothers.ad`.
2. Confirm the first screen is the Google login gate.
3. Sign in with a Super Admin Google account.
4. Confirm Admin Access, Global Indexes, Payments, Accounting, Contractor Portal, and Communications render only after login.
5. Confirm contractor or worker accounts cannot see global indexes.
6. Open `https://brothers.ad/api/auth/config` and confirm:
   - `webConfigured` is `true`
   - `adminConfigured` is `true`
   - `projectId` is `brothers-restoration-website`
