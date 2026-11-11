import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentekClient } from "../client.js";
import { createCoindeskNewsTool } from "../coindesk/tools.js";
import { createMarketEventsTool } from "../coinmarketcal/tools.js";
import { createSearchRecentTweetsTool } from "../twitter/tools.js";
import { createImageGenAndPinTool } from "../imagegen/tools.js";
import { createTallyChainsTool } from "../tally/tools.js";
import { searchJupiterTokens } from "../solana/market.js";
const client = {authorizeAction: async () => undefined} as unknown as AgentekClient;
afterEach(() => vi.unstubAllGlobals());

describe("fixed provider integrations", () => {
  it("pins credentialed requests and preserves legitimate response formats", async () => {
    const values = [
      {Data: [{ID: 1, TITLE: "News"}]},
      {body: [{id: 2, title: "Event", vote_history: [1], view_history: [2]}]},
      {data: [{id: "3", text: "Tweet"}], meta: {result_count: 1}},
      {data: {chains: [{id: "eip155:1"}]}},
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(values.shift()));
    }));
    await expect(createCoindeskNewsTool("key").execute(client, {})).resolves.toEqual({articles: [{ID: 1, TITLE: "News"}]});
    await expect(createMarketEventsTool("key").execute(client, {})).resolves.toEqual([{id: 2, title: "Event"}]);
    await expect(createSearchRecentTweetsTool("key").execute(client, {query: "token"})).resolves.toMatchObject({tweets: [{id: "3", text: "Tweet"}], resultCount: 1});
    await expect(createTallyChainsTool("key").execute(client, {})).resolves.toEqual({chains: [{id: "eip155:1"}]});
    expect(values).toEqual([]);
  });

  it("rejects oversized Jupiter listings before parsing", async () => {
    const cancelled = vi.fn();
    let sent = 0;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { if (sent++ < 5) controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel: cancelled,
    })));
    await expect(searchJupiterTokens("SOL", "key", fetcher)).rejects.toThrow(/^Jupiter token search failed: unavailable or invalid response$/);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("bounds image bytes before creating a publication request", async () => {
    let sent = 0;
    const cancelled = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { if (sent++ < 17) controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel: cancelled,
    })));
    vi.stubGlobal("fetch", fetcher);
    const tool = createImageGenAndPinTool({fireworksApiKey: "key", pinataJWT: "jwt"});
    await expect(tool.execute(client, {prompt: "A tree"})).rejects.toThrow(/^Image generation failed: unavailable or invalid response$/);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("keeps image and publication formats with bounded transport on both requests", async () => {
    const cid = "Qm" + "a".repeat(44);
    const fetcher = vi.fn(async (url, init) => {
      expect(init.redirect).toBe("error");
      if (String(url).includes("fireworks.ai")) return new Response(new Uint8Array([137, 80, 78, 71]));
      expect(init.body).toBeInstanceOf(FormData);
      expect(await init.body.get("file").arrayBuffer()).toEqual(new Uint8Array([137, 80, 78, 71]).buffer);
      return new Response(JSON.stringify({IpfsHash: cid}));
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(createImageGenAndPinTool({fireworksApiKey: "key", pinataJWT: "jwt"}).execute(client, {prompt: "A tree"})).resolves.toEqual({prompt: "A tree", ipfsCid: cid, ipfsUrl: `https://content.wrappr.wtf/ipfs/${cid}`});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
