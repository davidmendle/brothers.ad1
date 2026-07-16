import { notFound } from "next/navigation";
import { getPostBySlug } from "../../../lib/blogData";
import { siteUrl } from "../../../lib/siteConfig";
import { sanitizeJsonForDom } from "../../../lib/securityUtils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const published = post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined;
  const updated = post.updatedAt
    ? new Date(post.updatedAt).toISOString()
    : published || new Date().toISOString();

  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    alternates: {
      canonical: `/blog/${post.slug}`
    },
    keywords: [
      post.category,
      "AI automation",
      "blog",
      "B2B operations",
      "AI agents",
      "custom software"
    ].filter(Boolean),
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
      url: `${siteUrl}/blog/${post.slug}`,
      images: post.imageUrl ? [{ url: post.imageUrl, alt: post.imageAlt || post.title }] : [],
      locale: "en_US",
      type: "article"
    },
    robots: {
      index: true,
      follow: true
    },
    other: {
      published_time: published || undefined,
      modified_time: updated
    }
  };
}

export default async function BlogPostPage({ params }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const publishedAt = post.publishedAt ? new Date(post.publishedAt).toISOString() : new Date().toISOString();

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    image: post.imageUrl || undefined,
    datePublished: publishedAt,
    dateModified: new Date(post.updatedAt || post.publishedAt || Date.now()).toISOString(),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${siteUrl}/blog/${post.slug}`
    },
    publisher: {
      "@type": "Organization",
      name: "Brothers.ad",
      url: siteUrl
    },
    author: {
      "@type": "Organization",
      name: "Brothers.ad"
    },
    about: {
      "@type": "Thing",
      name: post.category || "AI Automation"
    },
    inLanguage: "en-US"
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteUrl
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${siteUrl}/blog`
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
        item: `${siteUrl}/blog/${post.slug}`
      }
    ]
  };

  return (
    <main className="page-shell">
      <article className="article wrap">
        <a className="learn" href="/blog">
          Back to Blog
        </a>
        <p className="eyebrow">{post.category}</p>
        <h1 className="page-title">{post.title}</h1>
        <p className="article-meta">{post.readTime}</p>
        <p className="lead">{post.excerpt}</p>
        {post.imageUrl ? <img className="article-hero-image" src={post.imageUrl} alt={post.imageAlt || post.title} /> : null}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJsonForDom(articleSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJsonForDom(breadcrumbSchema) }} />
        {post.body.map((paragraph, index) => (
          <p key={`${post.slug}-p-${index}`}>{paragraph}</p>
        ))}
        {post.sourceUrls?.length ? (
          <div className="article-sources">
            <h2>Sources</h2>
            <ul>
              {post.sourceUrls.map((sourceUrl) => (
                <li key={sourceUrl}>
                  <a href={sourceUrl} rel="noreferrer" target="_blank">
                    {sourceUrl}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="article-cta">
          <h2>Want this inside your business?</h2>
          <p>Book a free AI automation audit and see where Brothers.ad can save time, recover leads, and improve operations.</p>
          <a className="btn primary" href="/#contact">
            Book AI Audit
          </a>
        </div>
      </article>
    </main>
  );
}
