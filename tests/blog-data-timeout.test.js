import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "test-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "test-project",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "test.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123456:web:test"
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.BLOG_FETCH_TIMEOUT_MS;
  Object.keys(firebaseEnvironment).forEach((key) => delete process.env[key]);
});

describe("blog Firestore fallback", () => {
  it("aborts an unavailable Firestore request and returns fallback posts", async () => {
    Object.assign(process.env, firebaseEnvironment, { BLOG_FETCH_TIMEOUT_MS: "50" });
    const fetchMock = vi.fn((_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    const { getPublishedPosts } = await import("../lib/blogData.js");
    const posts = await getPublishedPosts();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(posts.length).toBeGreaterThan(0);
  });
});
