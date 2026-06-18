# brothers.ad Next/Vercel Site

This repository is a full Next.js app for `brothers.ad`, not a static HTML export.

## Run locally

```txt
pnpm install
pnpm build
pnpm start
```

## GitHub/Vercel

The Vercel project should point at the folder that contains:

- `app/`
- `components/`
- `lib/`
- `public/`
- `package.json`
- `pnpm-lock.yaml`
- `vercel.json`

## Vercel Project Settings

- Framework Preset: `Next.js`
- Root Directory: `brothers-ad-vercel` for the connected `davidmendle/Brothers.ad` repo
- Build Command: default or blank
- Output Directory: default or blank
- Install Command: default or blank

## Vercel Domains

Add these domains inside the new Vercel project:

- `brothers.ad`
- `www.brothers.ad`

## Firebase Environment Variables

Do not commit Firebase config values to GitHub. Add them in Vercel Project Settings -> Environment Variables, then redeploy:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `NEXT_PUBLIC_ADMIN_EMAILS`
- `RESEND_API_KEY`
- `LEAD_NOTIFICATION_FROM`

Lead notifications from the AI audit form are sent only to `david@brothersrestoration.org`.
Use `RESEND_API_KEY` for server-side email delivery. `LEAD_NOTIFICATION_FROM` should be a verified sender in Resend, for example `Brothers.ad <leads@brothers.ad>`.

## Namecheap DNS

Keep only these host records for `brothers.ad`:

```txt
Type: A Record
Host: @
Value: 76.76.21.21
TTL: Automatic

Type: CNAME Record
Host: www
Value: cname.vercel-dns.com
TTL: Automatic
```

Delete any Namecheap parking records, URL redirect records, or blank records.

Namecheap never points to a Vercel project ID. Namecheap points to Vercel DNS, then Vercel routes the domain to the project where you added `brothers.ad`.

## If Vercel Still Shows 404

Check these three things:

1. In GitHub, the Vercel root directory must contain `app/`, `package.json`, and `pnpm-lock.yaml`.
2. In Vercel, Root Directory must be `brothers-ad-vercel` for the connected project.
3. In Vercel -> Settings -> Domains, `brothers.ad` and `www.brothers.ad` must be added to this exact project.

After fixing any of those, redeploy the latest commit from Vercel -> Deployments.
