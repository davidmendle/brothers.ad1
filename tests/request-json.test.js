import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../request-json.js";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded browser requests", () => {
  it("returns HTTP errors to the caller without retrying writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, result } = await requestJson("/api/workspace-state", { method: "PUT" });
    expect(response.status).toBe(409);
    expect(result.message).toBe("Conflict");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts an unresponsive request and returns an actionable error", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    await expect(requestJson("/api/workspace-state", {}, 5)).rejects.toThrow("refresh the latest records");
  });

  it("keeps the deadline active while the response body is loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, { signal }) => ({
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    })));
    await expect(requestJson("/api/access/context", {}, 5)).rejects.toThrow("too long");
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => Promise.reject(signal.reason)));
    await expect(requestJson("/api/emergency/incidents", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
