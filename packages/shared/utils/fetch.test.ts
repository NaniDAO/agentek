import { afterEach, describe, expect, it, vi } from "vitest";
import { providerBytes, providerJSON, readBoundedJSON } from "./fetch.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded provider transport", () => {
  it("accepts an exact UTF-8 byte budget without trusting Content-Length", async () => {
    const text = JSON.stringify({name: "é"});
    const size = new TextEncoder().encode(text).length;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(text, {headers: {"content-length": "1"}});
    }));
    await expect(providerJSON("https://provider.example", {}, "Lookup failed", {maximumBytes: size})).resolves.toEqual({name: "é"});
    await expect(providerJSON("https://provider.example", {}, "Lookup failed", {maximumBytes: size - 1})).rejects.toThrow("Lookup failed");
  });

  it("cancels a streamed overflow before parsing it", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(33)); },
      cancel: cancelled,
    });
    await expect(readBoundedJSON(new Response(body), 32)).rejects.toThrow(/large/);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("expires and cancels a response that stalls after its headers", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    let signal: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({cancel: cancelled}));
    }));
    const pending = expect(providerJSON("https://provider.example", {}, "Lookup failed", {timeoutMs: 25})).rejects.toThrow("Lookup failed");
    await vi.advanceTimersByTimeAsync(26);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("propagates caller cancellation while waiting for a body chunk", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({cancel: cancelled}))));
    const pending = expect(providerBytes("https://provider.example", {signal: controller.signal})).rejects.toThrow("Provider request failed");
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error("secret-provider-diagnostic"));
    await pending;
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("never exposes provider diagnostics, status text, or URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bearer private-key", {status: 403, statusText: "private-key"})));
    await expect(providerJSON("https://provider.example/?api_key=private-key", {}, "Lookup failed")).rejects.toThrow(/^Lookup failed: HTTP 403$/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("https://provider.example/private-key"); }));
    await expect(providerJSON("https://provider.example", {}, "Lookup failed")).rejects.toThrow(/^Lookup failed: unavailable or invalid response$/);
  });
});
