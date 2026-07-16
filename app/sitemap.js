import { getPublishedPosts } from "../lib/blogData";
import { siteUrl } from "../lib/siteConfig";

export default async function sitemap() {
  const posts = await getPublishedPosts();
  const staticRoutes = ["", "/blog", "/privacy", "/terms"].map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7
  }));

  const blogRoutes = posts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt || post.updatedAt || post.createdAt || Date.now()),
    changeFrequency: "monthly",
    priority: 0.8
  }));

  return [...staticRoutes, ...blogRoutes];
}
