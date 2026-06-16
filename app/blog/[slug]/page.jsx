import { notFound } from "next/navigation";
import { getPostBySlug, getPublishedPosts } from "../../../lib/blogData";

export const revalidate = 60;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    alternates: {
      canonical: `/blog/${post.slug}`
    },
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
      url: `https://www.brothers.ad/blog/${post.slug}`,
      type: "article"
    }
  };
}

export async function generateStaticParams() {
  const posts = await getPublishedPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export default async function BlogPostPage({ params }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

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
        {post.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
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
