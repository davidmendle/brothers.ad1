# Insurance Intake Setup

Replace these values before production:

- `https://brothers.ad`
  Use this on your public website when posting to the operating system backend.
- `https://YOUR-MAIN-WEBSITE-DOMAIN.com`
  Replace this with your real public website domain in `ALLOWED_WEBSITE_ORIGIN`.
- `INSURANCE_API_KEY`
  Keep this server-side only. Do not expose it in dashboard JavaScript.
- `ADMIN_EMAILS`, `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET`
  These secure the admin dashboard API. All administrative routes now require a valid authenticated session cookie.
- `BLOB_READ_WRITE_TOKEN`
  Recommended for production durability on Vercel. When present, intake records and uploaded files are stored in Vercel Blob instead of local runtime storage.
- `DATABASE_URL`
  Use local SQLite for development. Production can keep this as a local fallback when Blob storage is configured.

Environment variables:

```bash
INSURANCE_API_KEY=replace_me
ADMIN_EMAILS=owner@example.com,operator@example.com
ADMIN_PASSWORD=replace_with_a_long_unique_password
ADMIN_JWT_SECRET=replace_with_a_long_random_secret_at_least_32_characters
ADMIN_SESSION_TTL_MS=43200000
ALLOWED_WEBSITE_ORIGIN=https://YOUR-MAIN-WEBSITE-DOMAIN.com
DATABASE_URL=file:./prisma/dev.db
OS_BASE_URL=https://brothers.ad
# Optional for durable production storage on Vercel:
# BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx
```

Initial admin auth setup:

1. Set `ADMIN_EMAILS` to one or more owner/operator login emails separated by commas.
2. Set `ADMIN_PASSWORD` to a long unique password stored only in the server environment.
3. Set `ADMIN_JWT_SECRET` to a long random secret, at least 32 characters.
4. Optionally set `ADMIN_SESSION_TTL_MS` if you want a shorter or longer admin session lifetime. Default is 12 hours.
5. For production behind HTTPS, leave `ADMIN_COOKIE_SECURE` unset or set it to `true`. Only set it to `false` for local HTTP development.
6. For durable production intake storage on Vercel, create a private Blob store and attach `BLOB_READ_WRITE_TOKEN` to the project.

Admin authentication API:

- `POST /api/admin/login`
  Send JSON: `{ "email": "owner@example.com", "password": "..." }`
  On success, the server issues an HTTP-only signed session cookie.
- `GET /api/admin/session`
  Returns the current authenticated admin session.
- `POST /api/admin/logout`
  Clears the admin session cookie.

Security behavior:

- Administrative routes no longer trust `Origin` or `Referer` headers.
- `GET /api/insurance-intake`
- `GET /api/insurance-intake/:id`
- `PATCH /api/insurance-intake/:id/status`
- `PATCH /api/insurance-intake/:id/notes`
  All now require a valid authenticated admin session cookie.

Frontend website example:

```js
const formData = new FormData();
formData.append("fullName", fullName);
formData.append("phone", phone);
formData.append("email", email);
formData.append("propertyAddress", propertyAddress);
formData.append("insuranceCompanyName", insuranceCompanyName);
formData.append("claimNumber", claimNumber);
formData.append("policyNumber", policyNumber);
formData.append("damageDescription", damageDescription);
files.forEach(file => formData.append("files", file));

fetch("https://brothers.ad/api/insurance-intake", {
  method: "POST",
  headers: {
    Authorization: "Bearer REPLACE_WITH_PRIVATE_API_KEY"
  },
  body: formData
});
```

Notes:

- Do not set `Content-Type` manually when sending `FormData`.
- The runtime currently creates the SQLite `insurance_submissions` table automatically on server startup from the backend schema expectations.
- A Prisma schema file is included as a model reference for future migration work.
- The admin session cookie is `HttpOnly`, `SameSite=Lax`, and is marked `Secure` automatically when the request is served over HTTPS unless `ADMIN_COOKIE_SECURE=false` is set for local development.
- The public website can bootstrap its insurance form from `GET /api/insurance-intake/public-config` so the upload URL, admin login URL, file limits, and allowed origin stay server-driven.
- The OS readiness check is available at `GET /api/health`, which returns whether the insurance intake API key and admin auth are configured, whether the intake backend is using durable Blob storage, and a `warnings` array for placeholder domains, legacy base URLs, or non-durable production storage.
- Uploaded evidence is now served through authenticated admin routes instead of a public `/uploads` path.
