import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import React, { Children, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context.shared-runtime";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import BrothersOsShell from "../components/BrothersOsShell.jsx";
import { brothersLogoDataUrl } from "../logo-data.js";

// Exercise Next's installed SSR preload and real OS modules without a Next build,
// generated public files, shared server, real credentials, or external services.
const assetNames = [
  "app.js", "module-data.js", "application-registry.js", "firebase-client.js",
  "ui-security.js", "request-json.js", "emergency-monitor.js", "pricing-import.js",
  "import-files.js", "manual-time.js", "equipment-lifecycle.js", "styles.css"
];

describe("OS module asset loading", () => {
  let browser, server, origin, assets, runtime;
  let html = "";
  let requests = [];

  beforeAll(async () => {
    // The existing Vitest config uses classic JSX; the application uses Next's transform.
    vi.stubGlobal("React", React);
    runtime = Children.toArray(BrothersOsShell().props.children)
      .find((child) => child.props?.id === "brothers-os-runtime");
    assets = new Map(await Promise.all(assetNames.map(async (name) => [
      `/${name}`, await readFile(new URL(`../${name}`, import.meta.url))
    ])));
    assets.set("/brothers-shield.png", Buffer.from(brothersLogoDataUrl.split(",")[1], "base64"));
    server = createServer((request, response) => {
      const asset = assets.get(request.url);
      const body = asset && (request.url.endsWith(".png") ? asset : gzipSync(asset));
      requests.push({
        path: request.url, method: request.method,
        mode: request.headers["sec-fetch-mode"], cookie: request.headers.cookie || "",
        decodedBytes: asset?.length || 0, encodedBytes: body?.length || 0
      });
      response.setHeader("Cache-Control", "no-store");
      if (request.method !== "GET") {
        response.writeHead(405).end();
      } else if (request.url === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end(html);
      } else if (asset) {
        response.setHeader("Content-Type", request.url.endsWith(".png") ? "image/png"
          : request.url.endsWith(".css") ? "text/css" : "text/javascript");
        if (!request.url.endsWith(".png")) response.setHeader("Content-Encoding", "gzip");
        response.end(body);
      } else if (["/api/auth/config", "/api/auth/session"].includes(request.url)) {
        response.setHeader("Content-Type", "application/json");
        response.statusCode = request.url === "/api/auth/session" ? 401 : 200;
        response.end(JSON.stringify(request.url === "/api/auth/config"
          ? { firebase: { enabled: true } } : { success: false }));
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      browser = await chromium.launch({ headless: true, channel: "msedge" });
    }
  }, 60000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    const httpCleanup = server ? new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }) : Promise.resolve();
    try { await browser?.close(); }
    finally { await httpCleanup; }
  }, 30000);

  function renderShell(crossOrigin) {
    const children = Children.toArray(BrothersOsShell().props.children).map((child) =>
      child.props?.id === runtime.props.id ? React.cloneElement(child, { crossOrigin }) : child);
    return "<!doctype html>" + renderToStaticMarkup(createElement(
      HeadManagerContext.Provider, { value: { appDir: true } },
      createElement("html", null, createElement("head", null,
        createElement("link", { rel: "icon", href: "data:," })),
      createElement("body", null, children))
    ));
  }

  it("keeps post-hydration execution and emits one CORS-compatible Next preload", () => {
    expect(runtime.props).toMatchObject({
      src: "/app.js", type: "module", strategy: "afterInteractive", crossOrigin: "anonymous"
    });
    const markup = renderShell(runtime.props.crossOrigin);
    const preload = markup.match(/<link\b[^>]*href="\/app\.js"[^>]*>/g);
    expect(preload).toHaveLength(1);
    expect(preload[0]).toContain('rel="preload"');
    expect(preload[0]).toContain('as="script"');
    expect(preload[0]).toMatch(/crossorigin="(?:anonymous)?"/);
    expect(markup).not.toMatch(/<script\b[^>]*src="\/app\.js"/);
  });

  async function coldLoad(crossOrigin) {
    requests = [];
    html = renderShell(crossOrigin);
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.addCookies([{ name: "os-fixture", value: "same-origin", url: origin }]);
    const page = await context.newPage();
    const errors = [];
    const blocked = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      const firebaseBase = "https://www.gstatic.com/firebasejs/12.15.0/";
      if (url.href === `${firebaseBase}firebase-app.js`) return route.fulfill({
        contentType: "text/javascript", body: "export const initializeApp=()=>({}),getApps=()=>[];"
      });
      if (url.href === `${firebaseBase}firebase-auth.js`) return route.fulfill({
        contentType: "text/javascript",
        body: "export const getAuth=()=>({});export class GoogleAuthProvider{};export function signInWithPopup(){throw Error('Login is outside this fixture');}"
      });
      blocked.push(url.href);
      return route.abort();
    });
    try {
      await page.goto(origin, { waitUntil: "load" });
      expect(await page.locator("#app").innerHTML()).toBe("");
      // Model afterInteractive insertion only; do not claim to measure Next hydration.
      await page.evaluate(({ src, type, id, crossOrigin }) => new Promise((resolve, reject) => {
        window.osBootDomReplacements = 0;
        new MutationObserver((mutations) => {
          window.osBootDomReplacements += mutations.length;
        }).observe(document.getElementById("app"), { childList: true });
        const script = document.createElement("script");
        Object.assign(script, { src, type, id });
        if (crossOrigin !== undefined) script.crossOrigin = crossOrigin;
        script.onload = resolve;
        script.onerror = () => reject(new Error("OS module failed to load"));
        document.body.appendChild(script);
      }), { ...runtime.props, crossOrigin });
      await page.waitForFunction(() =>
        document.querySelector(".google-login-button")?.textContent === "Continue with Google");
      await page.waitForFunction(() => [...document.images].every((image) => image.complete));
      expect(await page.locator("#app h1").innerText()).toBe("Sign in to Brothers OS");
      expect(await page.locator(".app-shell").count()).toBe(0);
      expect(errors).toEqual([]);
      expect(blocked).toEqual([]);
      expect(requests.filter(({ path }) => path.startsWith("/api/")).map(({ path }) => path))
        .toEqual(["/api/auth/config", "/api/auth/session"]);
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(requests.filter(({ path }) => path.startsWith("/vendor/") || path === "/logo-data.js"))
        .toEqual([]);
      // Count JS/CSS separately: repeated login renders can replace the logo while
      // its request is in flight, which makes uncached image counts timing-dependent.
      const assetRequests = requests.filter(({ path }) => /\.(?:js|css)$/.test(path));
      const appRequests = assetRequests.filter(({ path }) => path === "/app.js");
      expect(appRequests.every(({ cookie }) => cookie.includes("os-fixture=same-origin"))).toBe(true);
      return {
        appRequests: appRequests.length, appModes: appRequests.map(({ mode }) => mode),
        bootDomReplacements: await page.evaluate(() => window.osBootDomReplacements),
        assetRequests: assetRequests.length,
        decodedAssetBytes: assetRequests.reduce((sum, request) => sum + request.decodedBytes, 0),
        encodedAssetBytes: assetRequests.reduce((sum, request) => sum + request.encodedBytes, 0)
      };
    } finally { await context.close(); }
  }

  it("reuses the preload on cold boot without fetching private data or optional parsers", async () => {
    const samples = [];
    for (let run = 0; run < 3; run++) {
      const baseline = await coldLoad(undefined);
      const after = await coldLoad(runtime.props.crossOrigin);
      expect(baseline.appModes).toEqual(["no-cors", "cors"]);
      expect(baseline.appRequests).toBe(2);
      expect(after.appModes).toEqual(["cors"]);
      expect(after.appRequests).toBe(1);
      expect(baseline.assetRequests - after.assetRequests).toBe(1);
      expect(baseline.decodedAssetBytes - after.decodedAssetBytes).toBe(assets.get("/app.js").length);
      expect(baseline.encodedAssetBytes - after.encodedAssetBytes).toBe(gzipSync(assets.get("/app.js")).length);
      samples.push({ baseline, after });
    }
    console.log("OS asset benchmark " + JSON.stringify({
      boundary: "Isolated loopback fixture, fresh browser contexts, no-store assets; gzip JS/CSS. Next SSR preload + modeled script insertion, not full hydration or production latency. API/Firebase fixtures; no live data. Counts/bytes cover JS/CSS only, excluding HTML, images, headers and fixture responses.",
      browser: browser.version(),
      appBytes: assets.get("/app.js").length,
      appSha256: createHash("sha256").update(assets.get("/app.js")).digest("hex"),
      shieldPngBytes: assets.get("/brothers-shield.png").length, samples
    }));
  }, 60000);
});
