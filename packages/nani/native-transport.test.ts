import {afterEach, expect, it, vi} from "vitest";
import {installPublicTransport} from "./native-transport.js";
import {installCredentialTransport} from "../shared/credentialTools/index.js";
afterEach(() => {vi.unstubAllGlobals(); delete (globalThis as any).__agentekPublicFetch;});
it("uses a negotiated public-fetch bridge without credentials and reconstructs a Response", async () => {
  const host = vi.fn(async () => ({status: 200, headers: {"content-type": "application/json"}, body: btoa('{"name":"Fixture"}')}));
  vi.stubGlobal("__agentekHostCapabilities", {schemaVersion: 1, publicFetch: 1});
  vi.stubGlobal("webkit", {messageHandlers: {agentekPublicFetch: {postMessage: host}}});
  installPublicTransport();
  const result = await (globalThis as any).__agentekPublicFetch(new Request("https://ipfs.io/ipfs/fixture"), {maximumBytes: 2_000_000, timeoutMs: 15000});
  expect(result).toBeInstanceOf(Response); expect(await result.json()).toEqual({name: "Fixture"});
  expect(host.mock.calls[0][0]).toMatchObject({type: "request", method: "GET", maximumResponseBytes: 1_000_000});
  expect(host.mock.calls[0][0]).not.toHaveProperty("headers");
});
it("does not install native public fetching without an explicit compatible capability", () => {
  vi.stubGlobal("__agentekHostCapabilities", {});
  vi.stubGlobal("webkit", {messageHandlers: {agentekPublicFetch: {postMessage: vi.fn()}}});
  installPublicTransport(); expect((globalThis as any).__agentekPublicFetch).toBeUndefined();
});
it("preserves the old credential request shape for an existing app", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const host = vi.fn(async (message: any) => {
    expect(Object.keys(message).sort()).toEqual(["body", "headers", "method", "url"]);
    return {status: 200, body: btoa('{}')};
  });
  installCredentialTransport(host, 0);
  expect(await (await fetch("https://api.x.com/2/tweets/1")).json()).toEqual({});
});
it("cancels a negotiated public request and ignores late native completion", async () => {
  let finish: (value: any) => void;
  const host = vi.fn((message: any) => message.type === "cancel" ? Promise.resolve({cancelled: true}) : new Promise(resolve => {finish = resolve;}));
  vi.stubGlobal("__agentekHostCapabilities", {schemaVersion: 1, publicFetch: 1});
  vi.stubGlobal("webkit", {messageHandlers: {agentekPublicFetch: {postMessage: host}}});
  installPublicTransport();
  const controller = new AbortController();
  const request = (globalThis as any).__agentekPublicFetch(new Request("https://ipfs.io/x", {signal: controller.signal}), {maximumBytes: 1000, timeoutMs: 15000});
  await vi.waitFor(() => expect(host).toHaveBeenCalledTimes(1));
  controller.abort(new Error("cancelled")); await expect(request).rejects.toThrow(/cancelled/);
  expect(host.mock.calls[1][0]).toEqual({type: "cancel", requestId: host.mock.calls[0][0].requestId});
  finish!({status: 200, body: btoa('{}')});
});
