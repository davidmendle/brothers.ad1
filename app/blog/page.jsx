import { getPublishedPosts } from "../../lib/blogData";
import { siteUrl } from "../../lib/siteConfig";
import { sanitizeJsonForDom } from "../../lib/securityUtils";

export const revalidate = 60;

export const metadata = {
  title: "AI Automation Blog",
  description: "Articles on AI sales automation, AI operations systems, and review automation for business.",
  alternates: {
    canonical: "/blog"
  },
  openGraph: {
    title: "AI Automation Blog | Brothers.ad",
    description: "Practical articles for companies adopting custom AI agents and workflow automation.",
    url: `${siteUrl}/blog`,
    type: "website"
  }
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();
  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Brothers.ad AI Automation Blog",
    url: `${siteUrl}/blog`,
    description: "Practical articles for companies adopting custom AI agents and workflow automation.",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${siteUrl}/blog/${post.slug}`,
        name: post.title,
        description: post.excerpt
      }))
    }
  };

  return (
    <main className="page-shell">
      <section>
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Blog</p>
            <h1 className="page-title">AI Automation Insights</h1>
            <p>Practical articles for companies adopting custom AI agents, workflow automation, and AI operations systems.</p>
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: sanitizeJsonForDom(collectionSchema)
            }}
          />
          <div className="blog-grid">
            {posts.map((post) => (
              <article className="blog-card" key={post.slug}>
                {post.imageUrl ? (
                  <img className="blog-card-image" src={post.imageUrl} alt={post.imageAlt || post.title} loading="lazy" />
                ) : null}
                <span>{post.category}</span>
                <h2>{post.title}</h2>
                <p>{post.excerpt}</p>
                <a className="learn" href={`/blog/${post.slug}`}>
                  Read Article
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
