import { getPublishedPosts } from "../lib/blogData";

const baseUrl = "https://www.brothers.ad";

export default async function sitemap() {
  const posts = await getPublishedPosts();
  const staticRoutes = ["", "/blog", "/privacy", "/terms"].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7
  }));

  const blogRoutes = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.8
  }));

  return [...staticRoutes, ...blogRoutes];
}
