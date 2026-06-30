import { getPublishedPosts } from "../../lib/blogData";

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
    url: "https://www.brothers.ad/blog",
    type: "website"
  }
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <main className="page-shell">
      <section>
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Blog</p>
            <h1 className="page-title">AI Automation Insights</h1>
            <p>Practical articles for companies adopting custom AI agents, workflow automation, and AI operations systems.</p>
          </div>
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
