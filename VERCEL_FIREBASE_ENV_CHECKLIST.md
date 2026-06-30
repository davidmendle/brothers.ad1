# Vercel Firebase Environment Checklist

The hosted Brothers OS will stay locked until Firebase Google sign-in is configured in Vercel. This is intentional: invoices, contractor portals, revenue data, global indexes, invite codes, and admin screens should not render on the public web without verified authentication.

Official setup references:

- Firebase web app config: https://firebase.google.com/docs/web/setup
- Firebase Admin SDK credentials: https://firebase.google.com/docs/admin/setup
- Vercel environment variables: https://vercel.com/docs/environment-variables

## 1. Firebase web app variables

In Firebase Console, open Project settings, then General, then Your apps. Create or select the web app and copy the Firebase config values into Vercel.

Add these Vercel environment variables:

```text
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=brothers-restoration-website.firebaseapp.com
FIREBASE_PROJECT_ID=brothers-restoration-website
FIREBASE_STORAGE_BUCKET=brothers-restoration-website.firebasestorage.app
FIREBASE_APP_ID=1:80592032671:web:a4a236c46dda1eb12263aa
FIREBASE_MESSAGING_SENDER_ID=80592032671
FIREBASE_MEASUREMENT_ID=G-6Q0QNW5P10
```

Keep the Vercel values above explicit so the production deployment is easy to audit. If Firebase Console shows a different storage bucket, use the exact bucket shown there.

## 2. Firebase admin credentials

Use one of these two options.

Recommended Vercel option:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=
```

Paste the raw service-account JSON from Firebase Console. Keep it private. Do not commit it to GitHub.

Alternate option:

```text
FIREBASE_PROJECT_ID=brothers-restoration-website
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

If you use `FIREBASE_PRIVATE_KEY`, keep the newline markers as `\n` when entering the value in Vercel.

## 3. Google-only login and 48-hour sessions

Add or confirm these Vercel variables:

```text
FIREBASE_ALLOWED_SIGN_IN_PROVIDERS=google.com
FIREBASE_OWNER_ONLY_LOGIN=true
FIREBASE_ALLOWED_LOGIN_EMAILS=david@brothersrestoration.org
FIREBASE_SESSION_TTL_MS=172800000
SUPER_ADMIN_EMAILS=david@brothersrestoration.org
BLOCKED_ADMIN_EMAILS=chaim@brothersrestoration.org,reznikchaim@gmail.com
```

With `FIREBASE_OWNER_ONLY_LOGIN=true`, only emails listed in `FIREBASE_ALLOWED_LOGIN_EMAILS` can establish a hosted OS session. For this launch that means only `david@brothersrestoration.org` can log in. Emails in `BLOCKED_ADMIN_EMAILS` are denied even if an old Firebase Auth user, Firestore `admins` document, or OS user document still exists.

## 4. Invite email delivery

The app can create invite links and access codes without email delivery, but production email delivery needs an email provider key.

Add these Vercel variables when Resend is ready:

```text
RESEND_API_KEY=
INVITE_FROM_EMAIL=
INVITE_REPLY_TO_EMAIL=
```

`INVITE_REPLY_TO_EMAIL` is optional. `INVITE_FROM_EMAIL` should be a verified sender or verified domain in Resend.

## 5. Firebase Console settings

In Firebase Authentication:

1. Enable Google as a sign-in provider.
2. Add `brothers.ad` to authorized domains.
3. Add `www.brothers.ad` to authorized domains if it should redirect or support login.
4. Keep the production Vercel preview domain authorized only if you still use it for testing.

In Firestore:

1. Publish the project rules from `firestore.rules`.
2. Keep Super Admin access limited to trusted company emails.

## 6. Vercel deployment steps

In Vercel:

1. Open the deployed project.
2. Go to Settings, then Environment Variables.
3. Add the variables above for Production.
4. Add them for Preview and Development if those deployments should also work.
5. Set `OS_BASE_URL=https://brothers.ad`.
6. Go to Settings, then Domains, and attach `brothers.ad` plus `www.brothers.ad`.
7. Redeploy the latest deployment after saving the variables.

The live site will continue to show the locked setup screen until Vercel has the variables and the project is redeployed.
