"use client";

import { useEffect, useMemo, useState } from "react";
import { getFirebaseCompat } from "../lib/firebaseCompatClient";
import { adminEmails, isAdminEmail } from "../lib/firebaseConfig";

const emptyPost = {
  title: "",
  slug: "",
  category: "AI Automation",
  readTime: "5 min read",
  excerpt: "",
  bodyText: "",
  status: "draft",
  seoTitle: "",
  seoDescription: ""
};

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function postToForm(post) {
  return {
    title: post.title || "",
    slug: post.slug || "",
    category: post.category || "AI Automation",
    readTime: post.readTime || "5 min read",
    excerpt: post.excerpt || "",
    bodyText: Array.isArray(post.body) ? post.body.join("\n\n") : post.bodyText || "",
    status: post.status || "draft",
    seoTitle: post.seoTitle || "",
    seoDescription: post.seoDescription || ""
  };
}

export default function AdminBlogDashboard() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [services, setServices] = useState(null);
  const [posts, setPosts] = useState([]);
  const [form, setForm] = useState(emptyPost);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = useMemo(() => isAdminEmail(user?.email), [user]);

  useEffect(() => {
    let unsubscribe = null;
    let mounted = true;
    let authSettled = false;
    let authFallback = null;

    getFirebaseCompat()
      .then((loaded) => {
        if (!mounted) return;
        setServices(loaded);
        authFallback = window.setTimeout(() => {
          if (!mounted || authSettled) return;
          setUser(loaded.auth.currentUser || null);
          setAuthReady(true);
        }, 2500);
        unsubscribe = loaded.auth.onAuthStateChanged((currentUser) => {
          authSettled = true;
          if (authFallback) window.clearTimeout(authFallback);
          setUser(currentUser);
          setAuthReady(true);
        });
      })
      .catch((error) => {
        if (!mounted) return;
        setMessage(error.message || "Firebase failed to load.");
        setAuthReady(true);
      });

    return () => {
      mounted = false;
      if (authFallback) window.clearTimeout(authFallback);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authReady && isAdmin && services) {
      refreshPosts();
    }
  }, [authReady, isAdmin, services]);

  async function refreshPosts() {
    if (!services) return;
    setMessage("");
    try {
      const snapshot = await services.db.collection("blogPosts").orderBy("updatedAt", "desc").get();
      const items = snapshot.docs.map((item) => ({ slug: item.id, ...item.data() }));
      setPosts(items);
    } catch (error) {
      setMessage(error.message || "Could not load Firestore posts.");
    }
  }

  async function handleLogin() {
    if (!services) {
      setMessage("Firebase is still loading. Try again in a moment.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      await services.auth.signInWithPopup(services.provider);
    } catch (error) {
      setMessage(error.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
      slug: name === "title" && !current.slug ? slugify(value) : current.slug
    }));
  }

  function selectPost(post) {
    setSelectedSlug(post.slug);
    setForm(postToForm(post));
    setMessage("");
  }

  function resetForm() {
    setSelectedSlug("");
    setForm(emptyPost);
    setMessage("");
  }

  async function savePost(event) {
    event.preventDefault();
    if (!services) return;

    const slug = slugify(form.slug || form.title);
    if (!slug || !form.title || !form.excerpt || !form.bodyText) {
      setMessage("Title, slug, excerpt, and body are required.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const body = form.bodyText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

      const payload = {
        title: form.title.trim(),
        slug,
        category: form.category.trim() || "AI Automation",
        readTime: form.readTime.trim() || "5 min read",
        excerpt: form.excerpt.trim(),
        body,
        status: form.status,
        seoTitle: form.seoTitle.trim(),
        seoDescription: form.seoDescription.trim(),
        authorEmail: user.email,
        updatedAt: services.firebase.firestore.FieldValue.serverTimestamp()
      };

      if (!selectedSlug) {
        payload.createdAt = services.firebase.firestore.FieldValue.serverTimestamp();
      }

      if (selectedSlug && selectedSlug !== slug) {
        await services.db.collection("blogPosts").doc(selectedSlug).delete();
      }

      await services.db.collection("blogPosts").doc(slug).set(payload, { merge: true });
      setSelectedSlug(slug);
      setForm((current) => ({ ...current, slug }));
      await refreshPosts();
      setMessage("Blog post saved.");
    } catch (error) {
      setMessage(error.message || "Could not save this post.");
    } finally {
      setBusy(false);
    }
  }

  async function removePost(slug) {
    if (!services) return;

    const confirmed = window.confirm(`Delete "${slug}" from Firestore?`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("");
    try {
      await services.db.collection("blogPosts").doc(slug).delete();
      if (selectedSlug === slug) resetForm();
      await refreshPosts();
      setMessage("Blog post deleted.");
    } catch (error) {
      setMessage(error.message || "Could not delete this post.");
    } finally {
      setBusy(false);
    }
  }

  if (!authReady) {
    return (
      <main className="page-shell admin-shell">
        <section>
          <div className="wrap admin-narrow">
            <div className="admin-panel">Checking secure session...</div>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page-shell admin-shell">
        <section>
          <div className="wrap admin-narrow">
            <div className="admin-panel">
              <p className="eyebrow">Secure Login</p>
              <h1 className="page-title">Brothers.ad Admin</h1>
              <p className="lead">
                Sign in with the Google account that owns the site. Use Google 2-Step Verification on that account for
                email or phone MFA.
              </p>
              <button className="btn primary" type="button" onClick={handleLogin} disabled={busy}>
                Continue with Google
              </button>
              {message ? <p className="form-error">{message}</p> : null}
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page-shell admin-shell">
        <section>
          <div className="wrap admin-narrow">
            <div className="admin-panel">
              <p className="eyebrow">Access Restricted</p>
              <h1 className="page-title">Not an admin account</h1>
              <p className="lead">
                Signed in as {user.email}. Allowed admins: {adminEmails.join(", ")}.
              </p>
              <button className="btn secondary" type="button" onClick={() => services?.auth.signOut()}>
                Sign out
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell admin-shell">
      <section>
        <div className="wrap">
          <div className="admin-topbar">
            <div>
              <p className="eyebrow">Blog Admin</p>
              <h1 className="page-title">Publish AI Automation Articles</h1>
            </div>
            <div className="admin-session">
              <span>{user.email}</span>
              <button className="btn secondary small" type="button" onClick={() => services?.auth.signOut()}>
                Sign out
              </button>
            </div>
          </div>

          <div className="admin-grid">
            <aside className="admin-panel post-list">
              <div className="admin-list-head">
                <h2>Posts</h2>
                <button className="btn secondary small" type="button" onClick={resetForm}>
                  New
                </button>
              </div>
              {posts.length ? (
                posts.map((post) => (
                  <button
                    className={`post-row ${selectedSlug === post.slug ? "active" : ""}`}
                    key={post.slug}
                    type="button"
                    onClick={() => selectPost(post)}
                  >
                    <strong>{post.title}</strong>
                    <span>{post.status || "draft"} / {post.slug}</span>
                  </button>
                ))
              ) : (
                <p className="lead">No Firestore posts yet. Static fallback articles still show on the public blog.</p>
              )}
            </aside>

            <form className="admin-panel admin-form" onSubmit={savePost}>
              <div className="form-row">
                <label>
                  Title
                  <input value={form.title} onChange={(event) => updateField("title", event.target.value)} />
                </label>
                <label>
                  Slug
                  <input value={form.slug} onChange={(event) => updateField("slug", slugify(event.target.value))} />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Category
                  <input value={form.category} onChange={(event) => updateField("category", event.target.value)} />
                </label>
                <label>
                  Read time
                  <input value={form.readTime} onChange={(event) => updateField("readTime", event.target.value)} />
                </label>
              </div>
              <label>
                Excerpt
                <textarea rows="3" value={form.excerpt} onChange={(event) => updateField("excerpt", event.target.value)} />
              </label>
              <label>
                Body
                <textarea
                  rows="11"
                  value={form.bodyText}
                  onChange={(event) => updateField("bodyText", event.target.value)}
                  placeholder="Separate paragraphs with a blank line."
                />
              </label>
              <div className="form-row">
                <label>
                  SEO title
                  <input value={form.seoTitle} onChange={(event) => updateField("seoTitle", event.target.value)} />
                </label>
                <label>
                  SEO description
                  <input
                    value={form.seoDescription}
                    onChange={(event) => updateField("seoDescription", event.target.value)}
                  />
                </label>
              </div>
              <label>
                Status
                <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
              <div className="admin-actions">
                <button className="btn primary" type="submit" disabled={busy}>
                  Save Post
                </button>
                {selectedSlug ? (
                  <button className="btn danger" type="button" onClick={() => removePost(selectedSlug)} disabled={busy}>
                    Delete
                  </button>
                ) : null}
              </div>
              {message ? <p className={message.includes("saved") || message.includes("deleted") ? "form-success" : "form-error"}>{message}</p> : null}
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
