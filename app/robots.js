export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/login", "/api"]
      }
    ],
    sitemap: "https://www.brothers.ad/sitemap.xml",
    host: "https://www.brothers.ad"
  };
}
