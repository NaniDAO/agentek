import https from "node:https";
import { createHmac } from "node:crypto";
import { signOAuthGet } from "./transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentekClient } from "../client.js";
import { twitterTools } from "./index.js";
import { credentialTools } from "../credentialTools/index.js";

const client = {} as AgentekClient;
const credentials = {xApiKey: "consumer-key", xApiKeySecret: "consumer-secret", xAccessToken: "user-token", xAccessTokenSecret: "user-secret"};
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

// The signer must leave HTTP to the bounded provider transport.
const forbidSDKNetwork = () => vi.spyOn(https, "request").mockImplementation(() => {throw new Error("Unexpected SDK network request");});
const homeTool = async () => (await twitterTools(credentials)).find(tool => tool.name === "getHomeTimeline")!;

describe("bounded locally signed X timeline", () => {
  it("uses OAuth headers with bounded fetch for the account and timeline", async () => {
    const sdkNetwork = forbidSDKNetwork();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.x.com");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const auth = new Headers(init.headers).get("authorization");
      expect(auth).toMatch(/^OAuth /);
      expect(auth).toContain('oauth_consumer_key="consumer-key"');
      expect(auth).toContain('oauth_token="user-token"');
      expect(auth).toContain("oauth_signature=");
      expect(auth).not.toContain("consumer-secret");
      expect(auth).not.toContain("user-secret");
      if (url.pathname === "/2/users/me") return json({data: {id: "1234"}});
      expect(url.pathname).toBe("/2/users/1234/timelines/reverse_chronological");
      expect(url.searchParams.get("max_results")).toBe("10");
      expect(url.searchParams.get("exclude")).toBe("replies,retweets");
      expect(url.searchParams.get("tweet.fields")).toContain("created_at");
      return json({data: [{id: "55", text: "Timeline tweet", author_id: "1234"}], meta: {result_count: 1}});
    }));
    await expect((await homeTool()).execute(client, {excludeReplies: true, excludeRetweets: true})).resolves.toMatchObject({tweets: [{id: "55", text: "Timeline tweet"}], resultCount: 1});
    expect(sdkNetwork).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a stalled account body using the same request deadline", async () => {
    vi.useFakeTimers();
    const sdkNetwork = forbidSDKNetwork(), cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({cancel}))));
    const operation = expect((await homeTool()).execute(client, {})).rejects.toThrow(/^X timeline request failed: unavailable or invalid response$/);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(15_001);
    await operation;
    expect(cancel).toHaveBeenCalledOnce();
    expect(sdkNetwork).not.toHaveBeenCalled();
  });

  it("cancels oversized timeline bodies before parsing them", async () => {
    const sdkNetwork = forbidSDKNetwork(), cancel = vi.fn();
    let sent = 0;
    vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("/users/me") ? json({data: {id: "1234"}}) : new Response(new ReadableStream({
      pull(controller) {if (sent++ < 3) controller.enqueue(new Uint8Array(1024 * 1024));}, cancel,
    }))));
    await expect((await homeTool()).execute(client, {})).rejects.toThrow(/^X timeline request failed: unavailable or invalid response$/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(sdkNetwork).not.toHaveBeenCalled();
  });

  it("preserves the native v2 shim and its private credential reference", async () => {
    const sdkNetwork = forbidSDKNetwork();
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
      expect(new Headers(init.headers).get("x-nani-private")).toBe("true");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return String(input).includes("/users/me") ? json({data: {id: "1234"}}) : json({data: [{id: "55", text: "Native tweet"}], meta: {result_count: 1}});
    }));
    const tools = credentialTools(["x.apiKey", "x.apiKeySecret", "x.accessToken", "x.accessTokenSecret"]);
    await expect(tools.find(tool => tool.name === "getHomeTimeline")!.execute(client, {})).resolves.toMatchObject({tweets: [{id: "55", text: "Native tweet"}]});
    expect(sdkNetwork).not.toHaveBeenCalled();
  });
});

it("matches the published OAuth GET signing vector", async () => {
  // OAuth 1.0 example: photos.example.net/photos?file=vacation.jpg&size=original.
  const header = await signOAuthGet(new URL("http://photos.example.net/photos?file=vacation.jpg&size=original"), {
    appKey: "dpf43f3p2l4k3l03", appSecret: "kd94hf93k423kf44", accessToken: "nnch734d00sl2jdk", accessSecret: "pfkkdhi9sl3r4s00",
  }, "kllo9940pd9333jh", "1191242096");
  expect(header).toContain('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"');
});
it("signs encoded and repeated query parameters in canonical order", async () => {
  const url = new URL("https://api.x.com/2/users/me?a=z&a=%21&b=hello+world");
  const header = await signOAuthGet(url, {appKey: "key", appSecret: "secret!", accessToken: "token", accessSecret: "access&"}, "nonce", "123");
  const normalized = "a=%21&a=z&b=hello%20world&oauth_consumer_key=key&oauth_nonce=nonce&oauth_signature_method=HMAC-SHA1&oauth_timestamp=123&oauth_token=token&oauth_version=1.0";
  const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const expected = createHmac("sha1", "secret%21&access%26").update(`GET&${encode(url.origin + url.pathname)}&${encode(normalized)}`).digest("base64");
  expect(header).toContain(`oauth_signature="${encode(expected)}"`);
});
