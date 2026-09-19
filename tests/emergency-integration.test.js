import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createApp } = require("../createApp");

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function mediaPolicy(sources) {
  vi.stubEnv("EMERGENCY_FEEDS_JSON", typeof sources === "string" ? sources : JSON.stringify(sources));
  const { default: config } = await import("../next.config.mjs");
  const headers = (await config.headers())[0].headers;
  return headers.find((header) => header.key === "Content-Security-Policy").value.split("; ").find((part) => part.startsWith("media-src"));
}

describe("emergency deployment integration", () => {
  it("permits radio media only from configured HTTPS origins", async () => {
    expect(await mediaPolicy([
      { streamUrl: "https://radio.example/listen" },
      { streamUrl: "https://radio.example/other" },
      { streamUrl: "http://insecure.example/listen" },
      { streamUrl: "https://secret@private.example/listen" },
      { streamUrl: "https://token.example/listen?token=secret" }
    ])).toBe("media-src 'self' https://radio.example");
  });

  it.each(["not-json", "{}", "[]"])("fails closed for absent or malformed media configuration: %s", async (input) => {
    expect(await mediaPolicy(input)).toBe("media-src 'self'");
  });

  it("preserves exact signed bytes through the actual application parser", async () => {
    const secret = "integration-only-secret-".repeat(3);
    vi.stubEnv("EMERGENCY_FEEDS_JSON", JSON.stringify([{ id: "test", label: "Test", area: "Test", companyId: "test-company", secret }]));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{ "eventId": "test", "email": "excluded@example.com" }';
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const result = await request(createApp()).post("/api/emergency/webhooks/test")
      .set("Content-Type", "application/json")
      .set("x-emergency-timestamp", timestamp)
      .set("x-emergency-signature", `sha256=${signature}`)
      .send(body).expect(400);
    expect(result.body.message).toBe("Only the documented incident fields are accepted.");
  });

  it("rejects oversized emergency requests before authentication or storage", async () => {
    await request(createApp()).post("/api/emergency/webhooks/test").send({ summary: "x".repeat(33000) }).expect(413);
  });

  it("does not decompress untrusted emergency payloads", async () => {
    await request(createApp()).post("/api/emergency/webhooks/test")
      .set("Content-Type", "application/json").set("Content-Encoding", "gzip")
      .send(gzipSync(Buffer.from('{"eventId":"test"}'))).expect(415);
  });

  it("keeps the existing larger workspace body limit", async () => {
    await request(createApp()).put("/api/workspace-state").send({ notes: "x".repeat(40000) }).expect(401);
  });
});
