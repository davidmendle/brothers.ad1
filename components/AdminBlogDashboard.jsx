"use client";

import { useEffect, useMemo, useState } from "react";
import { getFirebaseCompat } from "../lib/firebaseCompatClient";
import { adminEmails, isAdminEmail } from "../lib/firebaseConfig";

const PDFJS_VERSION = "4.10.38";
const PDFJS_MODULE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_HERO_WIDTH = 1600;

const emptyPost = {
  title: "",
  slug: "",
  category: "AI Automation",
  readTime: "5 min read",
  excerpt: "",
  bodyText: "",
  status: "draft",
  scheduledAt: "",
  imageUrl: "",
  imageAlt: "",
  sourceUrlsText: "",
  seoTitle: "",
  seoDescription: ""
};

const emptyGenerator = {
  topic: "",
  audience: "B2B owners and operators",
  focus: "AI automation, operations, compliance, and revenue impact",
  length: "900 to 1,200 words"
};

let pdfJsPromise;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function splitSourceUrls(value) {
  return String(value || "")
    .split(/[,\n]+/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function safeFileName(value) {
  return String(value || "blog-image")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function dateFromFirestore(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatDateTimeLocal(value) {
  const date = dateFromFirestore(value);
  if (!date) return "";
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 16);
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
    scheduledAt: formatDateTimeLocal(post.scheduledAt),
    imageUrl: post.imageUrl || "",
    imageAlt: post.imageAlt || "",
    sourceUrlsText: Array.isArray(post.sourceUrls) ? post.sourceUrls.join("\n") : "",
    seoTitle: post.seoTitle || "",
    seoDescription: post.seoDescription || ""
  };
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.84) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare the blog image."));
    }, type, quality);
  });
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageFileToBlob(file) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_HERO_WIDTH / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return canvasToBlob(canvas);
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(/* webpackIgnore: true */ PDFJS_MODULE).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

async function pdfFileToImageBlob(file) {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(1, MAX_HERO_WIDTH / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    return canvasToBlob(canvas, "image/jpeg", 0.86);
  } finally {
    await pdf.destroy();
  }
}

async function fileToBlogImageBlob(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Upload must be under 12MB.");
  }
  if (file.type.startsWith("image/")) return imageFileToBlob(file);
  if (file.type === "application/pdf") return pdfFileToImageBlob(file);
  throw new Error("Upload an image file or a PDF.");
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function uploadBlobToStorage({ services, blob, slug, fileName }) {
  if (!services?.storage) {
    throw new Error("Firebase Storage is not configured.");
  }
  const folder = slugify(slug || "draft") || "draft";
  const name = `${Date.now()}-${safeFileName(fileName)}.jpg`;
  const ref = services.storage.ref().child(`blog-media/${folder}/${name}`);
  await ref.put(blob, {
    contentType: blob.type || "image/jpeg",
    customMetadata: { purpose: "blog-hero-image" }
  });
  return ref.getDownloadURL();
}

export default function AdminBlogDashboard() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [services, setServices] = useState(null);
  const [posts, setPosts] = useState([]);
  const [form, setForm] = useState(emptyPost);
  const [generator, setGenerator] = useState(emptyGenerator);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);

  const isAdmin = useMemo(() => isAdminEmail(user?.email), [user]);
  const anyBusy = busy || mediaBusy || generateBusy || publishBusy;

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
      slug: name === "title" && !current.slug ? slugify(value) : current.slug,
      imageAlt: name === "title" && !current.imageAlt ? value : current.imageAlt
    }));
  }

  function updateGeneratorField(name, value) {
    setGenerator((current) => ({ ...current, [name]: value }));
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

  async function handleMediaUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !services) return;

    const slug = slugify(form.slug || form.title || file.name) || "draft";
    setMediaBusy(true);
    setMessage("");
    try {
      const blob = await fileToBlogImageBlob(file);
      const imageUrl = await uploadBlobToStorage({
        services,
        blob,
        slug,
        fileName: file.name
      });
      setForm((current) => ({
        ...current,
        imageUrl,
        imageAlt: current.imageAlt || current.title || "Brothers.ad blog image"
      }));
      setMessage(file.type === "application/pdf" ? "PDF first page converted into the blog image." : "Blog image uploaded.");
    } catch (error) {
      setMessage(error.message || "Could not upload this media file.");
    } finally {
      setMediaBusy(false);
    }
  }

  async function generateDraft() {
    if (!user || !services) return;
    if (!generator.topic.trim()) {
      setMessage("Enter a topic or prompt for the generator.");
      return;
    }

    setGenerateBusy(true);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/blog/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(generator)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not generate the blog draft.");

      const article = data.article;
      let imageUrl = "";
      if (data.image?.base64) {
        const blob = await dataUrlToBlob(`data:${data.image.mimeType};base64,${data.image.base64}`);
        imageUrl = await uploadBlobToStorage({
          services,
          blob,
          slug: article.slug || article.title,
          fileName: article.slug || "generated-blog-image"
        });
      }

      setSelectedSlug("");
      setForm({
        ...emptyPost,
        title: article.title || "",
        slug: slugify(article.slug || article.title || ""),
        category: article.category || "AI Automation",
        readTime: article.readTime || "7 min read",
        excerpt: article.excerpt || "",
        bodyText: Array.isArray(article.body) ? article.body.join("\n\n") : "",
        status: "draft",
        imageUrl,
        imageAlt: article.imageAlt || article.title || "",
        sourceUrlsText: Array.isArray(article.sourceUrls) ? article.sourceUrls.join("\n") : "",
        seoTitle: article.seoTitle || article.title || "",
        seoDescription: article.seoDescription || article.excerpt || ""
      });

      setMessage(data.imageError ? `Draft generated. Image skipped: ${data.imageError}` : "Draft generated for review.");
    } catch (error) {
      setMessage(error.message || "Could not generate this draft.");
    } finally {
      setGenerateBusy(false);
    }
  }

  async function publishDuePosts() {
    if (!user) return;
    setPublishBusy(true);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/blog/publish-due", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not publish scheduled posts.");
      await refreshPosts();
      setMessage(`Published ${data.published?.length || 0} scheduled post(s).`);
    } catch (error) {
      setMessage(error.message || "Could not publish scheduled posts.");
    } finally {
      setPublishBusy(false);
    }
  }

  async function savePost(event) {
    event.preventDefault();
    if (!services) return;

    const slug = slugify(form.slug || form.title);
    if (!slug || !form.title || !form.excerpt || !form.bodyText) {
      setMessage("Title, slug, excerpt, and body are required.");
      return;
    }
    if (form.status === "scheduled" && !form.scheduledAt) {
      setMessage("Choose a scheduled publish time before setting this post to scheduled.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const body = form.bodyText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
      const scheduledDate = form.scheduledAt ? new Date(form.scheduledAt) : null;
      const FieldValue = services.firebase.firestore.FieldValue;
      const Timestamp = services.firebase.firestore.Timestamp;

      const payload = {
        title: form.title.trim(),
        slug,
        category: form.category.trim() || "AI Automation",
        readTime: form.readTime.trim() || "5 min read",
        excerpt: form.excerpt.trim(),
        body,
        status: form.status,
        scheduledAt: scheduledDate ? Timestamp.fromDate(scheduledDate) : null,
        imageUrl: form.imageUrl.trim(),
        imageAlt: form.imageAlt.trim() || form.title.trim(),
        sourceUrls: splitSourceUrls(form.sourceUrlsText),
        seoTitle: form.seoTitle.trim(),
        seoDescription: form.seoDescription.trim(),
        authorEmail: user.email,
        updatedAt: FieldValue.serverTimestamp()
      };

      if (!selectedSlug) {
        payload.createdAt = FieldValue.serverTimestamp();
      }
      if (form.status === "published") {
        payload.publishedAt = FieldValue.serverTimestamp();
      }

      if (selectedSlug && selectedSlug !== slug) {
        await services.db.collection("blogPosts").doc(selectedSlug).delete();
      }

      await services.db.collection("blogPosts").doc(slug).set(payload, { merge: true });
      setSelectedSlug(slug);
      setForm((current) => ({ ...current, slug }));
      await refreshPosts();
      setMessage(form.status === "scheduled" ? "Blog post scheduled." : "Blog post saved.");
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
              <button className="btn secondary small" type="button" onClick={publishDuePosts} disabled={anyBusy}>
                Publish Due
              </button>
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
                    <span>
                      {post.status || "draft"} / {post.slug}
                    </span>
                  </button>
                ))
              ) : (
                <p className="lead">No Firestore posts yet. Static fallback articles still show on the public blog.</p>
              )}
            </aside>

            <div className="admin-stack">
              <div className="admin-panel generator-panel">
                <div>
                  <p className="eyebrow">AI Draft Generator</p>
                  <h2>Generate a reviewed draft</h2>
                  <p className="form-note">
                    Uses public web search, then creates a draft and hero image. Review it before publishing or
                    scheduling.
                  </p>
                </div>
                <label>
                  Topic or prompt
                  <textarea
                    rows="3"
                    value={generator.topic}
                    onChange={(event) => updateGeneratorField("topic", event.target.value)}
                    placeholder="Example: OSHA silica dust basics for restoration contractors using AI job documentation"
                  />
                </label>
                <div className="form-row">
                  <label>
                    Audience
                    <input
                      value={generator.audience}
                      onChange={(event) => updateGeneratorField("audience", event.target.value)}
                    />
                  </label>
                  <label>
                    Focus
                    <input value={generator.focus} onChange={(event) => updateGeneratorField("focus", event.target.value)} />
                  </label>
                </div>
                <div className="admin-actions">
                  <label>
                    Length
                    <input
                      value={generator.length}
                      onChange={(event) => updateGeneratorField("length", event.target.value)}
                    />
                  </label>
                  <button className="btn primary" type="button" onClick={generateDraft} disabled={anyBusy}>
                    {generateBusy ? "Generating..." : "Generate Draft"}
                  </button>
                </div>
              </div>

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
                <div className="media-uploader">
                  {form.imageUrl ? (
                    <img className="media-preview" src={form.imageUrl} alt={form.imageAlt || "Blog image preview"} />
                  ) : (
                    <div className="media-placeholder">No blog image yet</div>
                  )}
                  <div className="media-controls">
                    <label>
                      Image URL
                      <input value={form.imageUrl} onChange={(event) => updateField("imageUrl", event.target.value)} />
                    </label>
                    <label>
                      Upload image or PDF first page
                      <input accept="image/*,application/pdf" type="file" onChange={handleMediaUpload} disabled={anyBusy} />
                    </label>
                    <label>
                      Image alt text
                      <input value={form.imageAlt} onChange={(event) => updateField("imageAlt", event.target.value)} />
                    </label>
                  </div>
                </div>
                <label>
                  Excerpt
                  <textarea rows="3" value={form.excerpt} onChange={(event) => updateField("excerpt", event.target.value)} />
                </label>
                <label>
                  Body
                  <textarea
                    rows="12"
                    value={form.bodyText}
                    onChange={(event) => updateField("bodyText", event.target.value)}
                    placeholder="Separate paragraphs with a blank line."
                  />
                </label>
                <label>
                  Source URLs
                  <textarea
                    rows="3"
                    value={form.sourceUrlsText}
                    onChange={(event) => updateField("sourceUrlsText", event.target.value)}
                    placeholder="One public source URL per line."
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
                <div className="form-row">
                  <label>
                    Status
                    <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
                      <option value="draft">Draft</option>
                      <option value="scheduled">Scheduled after review</option>
                      <option value="published">Published</option>
                    </select>
                  </label>
                  <label>
                    Scheduled publish time
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(event) => updateField("scheduledAt", event.target.value)}
                    />
                  </label>
                </div>
                <div className="admin-actions">
                  <button className="btn primary" type="submit" disabled={anyBusy}>
                    {busy ? "Saving..." : "Save Post"}
                  </button>
                  {selectedSlug ? (
                    <button className="btn danger" type="button" onClick={() => removePost(selectedSlug)} disabled={anyBusy}>
                      Delete
                    </button>
                  ) : null}
                </div>
                {message ? (
                  <p
                    className={
                      /saved|deleted|uploaded|converted|generated|scheduled|published/i.test(message)
                        ? "form-success"
                        : "form-error"
                    }
                  >
                    {message}
                  </p>
                ) : null}
              </form>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
