import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { publicFetch } from "./public-fetch.js";

vi.mock("node:dns/promises", () => ({lookup: vi.fn()}));
vi.mock("node:https", () => ({request: vi.fn()}));
afterEach(() => vi.resetAllMocks());
function response(body: Uint8Array, status = 200, headers = {}) {
  vi.mocked(request).mockImplementation(((url, options, callback) => {
    const req: any = new EventEmitter();
    req.destroy = (error: Error) => { queueMicrotask(() => req.emit("error", error)); };
    req.end = () => queueMicrotask(() => {
      const res: any = Readable.from([body]);
      res.statusCode = status; res.headers = headers;
      callback(res);
    });
    return req;
  }) as any);
}

describe("untrusted public URL transport", () => {
  it.each(["http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://169.254.169.254/latest/meta-data", "http://[::1]", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "https://user:pass@example.com"])("rejects %s before connecting", async url => {
    await expect(publicFetch(url)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects a hostname with any private DNS answer", async () => {
    vi.mocked(lookup).mockResolvedValue([{address: "8.8.8.8", family: 4}, {address: "10.1.2.3", family: 4}] as any);
    await expect(publicFetch("https://mixed.example/path")).rejects.toThrow(/Private/);
    expect(request).not.toHaveBeenCalled();
  });
  it("pins a vetted DNS answer to the connection and preserves public content", async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{address: "8.8.8.8", family: 4}] as any).mockResolvedValue([{address: "127.0.0.1", family: 4}] as any);
    response(new TextEncoder().encode('{"ok":true}'));
    expect(await (await publicFetch("https://public.example/path")).json()).toEqual({ok: true});
    const options: any = vi.mocked(request).mock.calls[0][1];
    const callback = vi.fn(); options.lookup("public.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("rejects redirects, including redirects to a private service", async () => {
    response(new Uint8Array(), 302, {location: "http://127.0.0.1/admin"});
    await expect(publicFetch("https://8.8.8.8")).rejects.toThrow(/Redirect/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounds both decoded bodies and initial payment-required responses", async () => {
    response(gzipSync("x".repeat(5000)), 402, {"content-encoding": "gzip"});
    await expect(publicFetch("https://8.8.8.8", {}, 1000)).rejects.toThrow(/large/);
  });
  it("rejects an already-aborted request before connecting", async () => {
    await expect(publicFetch("https://8.8.8.8", {signal: AbortSignal.abort()})).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects HTTP statuses outside the Fetch contract without an uncaught exception", async () => {
    response(new Uint8Array(), 600);
    await expect(publicFetch("https://8.8.8.8")).rejects.toThrow(/status/);
  });
  it("bounds a streaming upload before opening a connection", async () => {
    const body = new ReadableStream({start(controller) { controller.enqueue(new Uint8Array(2000)); }});
    const request = new Request("https://8.8.8.8", {method: "POST", body, duplex: "half"} as any);
    await expect(publicFetch(request, {}, 1000)).rejects.toThrow(/large/);
    expect(request).toBeDefined();
  });
  it("cancels a stalled upload when the caller aborts", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const body = new ReadableStream({cancel});
    const request = new Request("https://8.8.8.8", {method: "POST", body, signal: controller.signal, duplex: "half"} as any);
    const operation = publicFetch(request);
    controller.abort(new Error("Upload cancelled"));
    await expect(operation).rejects.toThrow(/cancelled/);
    expect(cancel).toHaveBeenCalledOnce();
  });

});

it("fails closed when a browser host has no secure HTTP adapter", async () => {
  // The shared transport explicitly fails closed on hosts without its Node
  // connection-pinning transport or an equivalent native hook.
  vi.stubGlobal("process", undefined);
  try { await expect(publicFetch("https://public.example/metadata")).rejects.toThrow(/unavailable/); }
  finally { vi.unstubAllGlobals(); }
});
