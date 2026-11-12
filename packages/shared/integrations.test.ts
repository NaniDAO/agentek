import { describe, expect, it, vi } from "vitest";
import { allTools } from "./index.js";
import { loadIntegrations, parseIntegrations } from "./integrations.js";
import { createAgentekClient } from "./client.js";
import { http } from "viem";
import { mainnet } from "viem/chains";

// Importing core must not evaluate optional modules, even in a full workspace.
vi.mock("@solana/web3.js", () => { throw new Error("Unexpected Solana SDK load"); });
vi.mock("cheerio", () => { throw new Error("Unexpected scraper load"); });
vi.mock("@x402/evm", () => { throw new Error("Unexpected payment SDK load"); });

describe("optional integration boundaries", () => {
  it("loads the default catalogue without payment, scraping, X or Solana SDKs", async () => {
    const names = (await allTools({})).map(tool => tool.name);
    expect(names).toContain("getBalance");
    expect(names).toContain("getQuote");
    expect(names).toContain("resolveWNS");
    expect(names).toContain("webPageExtractor");
    for (const name of ["getSolBalance", "x402Fetch", "scrapeWebContent", "getHomeTimeline"]) expect(names).not.toContain(name);
  });
  it("requires explicit integration selection and deduplicates names", async () => {
    expect(parseIntegrations()).toEqual([]);
    expect(parseIntegrations(" twitter, twitter ")).toEqual(["twitter"]);
    expect(() => parseIntegrations("solnaa")).toThrow(/Unknown integration/);
    expect(await loadIntegrations([])).toEqual({tools: [], solana: undefined});
    const integration = await loadIntegrations(["twitter"], {twitter: {xBearerToken: "fixture"}});
    const tools = await allTools({additionalTools: integration.tools});
    expect(tools.some(tool => tool.name === "searchRecentTweets")).toBe(true);
  });
  it("rejects Solana signing without an installed runtime before loading an SDK", async () => {
    const client = createAgentekClient({chains: [mainnet], transports: [http()], accountOrAddress: "0x1111111111111111111111111111111111111111", tools: [], solana: {privateKey: "fixture"}});
    await expect(client.getSolanaKeypair()).rejects.toThrow(/createSolanaConfig/);
  });
});
