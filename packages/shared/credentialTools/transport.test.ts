import { afterEach, describe, expect, it, vi } from "vitest";
import { installCredentialTransport } from "./index.js";
afterEach(() => vi.unstubAllGlobals());
describe("native credential request lifecycle", () => {
  it("preserves public JSON responses while keeping credentials out of host payloads", async () => {
    const original = vi.fn(); vi.stubGlobal("fetch", original);
    const host = vi.fn(async () => ({status: 200, body: btoa('{"ok":true}')}));
    installCredentialTransport(host);
    const response = await fetch("https://api.x.com/2/test", {headers: {authorization: "Bearer placeholder", accept: "application/json"}});
    expect(await response.json()).toEqual({ok: true});
    expect(host.mock.calls[0][0]).toMatchObject({type: "request", timeoutMs: 30000, maximumResponseBytes: 8388608, headers: {accept: "application/json"}});
    expect(JSON.stringify(host.mock.calls)).not.toContain("placeholder"); expect(original).not.toHaveBeenCalled();
  });
  it("rejects promptly on caller abort and sends the host a matching cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const host = vi.fn((request: any) => request.type === "cancel" ? Promise.resolve({}) : new Promise(() => {}));
    installCredentialTransport(host);
    const controller = new AbortController();
    const operation = fetch("https://api.x.com/2/test", {signal: controller.signal});
    await vi.waitFor(() => expect(host).toHaveBeenCalledTimes(1));
    controller.abort(new Error("Caller cancelled"));
    await expect(operation).rejects.toThrow(/cancelled/);
    expect(host.mock.calls).toHaveLength(2);
    expect(host.mock.calls[1][0]).toEqual({type: "cancel", requestId: host.mock.calls[0][0].requestId});
  });
  it("rejects an oversized native response before base64 decoding", async () => {
    vi.stubGlobal("fetch", vi.fn());
    installCredentialTransport(async () => ({status: 200, body: "A".repeat(12 * 1024 * 1024)}));
    await expect(fetch("https://api.x.com/2/test")).rejects.toThrow(/too large/);
  });
  it("cancels body preparation before contacting the host", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const host = vi.fn(), controller = new AbortController(), cancel = vi.fn();
    installCredentialTransport(host);
    const body = new ReadableStream({cancel});
    const operation = fetch(new Request("https://api.x.com/2/test", {method: "POST", body, signal: controller.signal, duplex: "half"} as any));
    controller.abort(new Error("Body cancelled"));
    await expect(operation).rejects.toThrow(/cancelled/);
    expect(cancel).toHaveBeenCalledOnce(); expect(host).not.toHaveBeenCalled();
  });

});
