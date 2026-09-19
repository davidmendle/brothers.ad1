function emergencyMediaOrigins() {
  try {
    const sources = JSON.parse(process.env.EMERGENCY_FEEDS_JSON || "[]");
    if (!Array.isArray(sources)) return [];
    return [...new Set(sources.flatMap((source) => {
      if (typeof source?.streamUrl !== "string") return [];
      const url = new URL(source.streamUrl);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? [url.origin] : [];
    }))];
  } catch { return []; }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  `media-src 'self' ${emergencyMediaOrigins().join(" ")}`.trim(),
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://www.googletagmanager.com https://cdn.jsdelivr.net",
  "connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://cdn.jsdelivr.net",
  "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
  "worker-src 'self' blob: https://cdn.jsdelivr.net"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "X-Frame-Options",
            value: "DENY"
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin"
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=()"
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups"
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin"
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy
          }
        ]
      }
    ];
  }
};

export default nextConfig;
