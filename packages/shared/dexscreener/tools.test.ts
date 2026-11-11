import { afterEach, describe, it, expect, vi } from "vitest";
import { getLatestTokens } from "./tools.js";
import { dexscreenerTools } from "./index.js";
import { createTestClient, validateToolStructure, withRetry } from "../test-helpers.js";
import { providerJSON } from "../utils/fetch.js";

const client = createTestClient(dexscreenerTools());
const address = (n: number) => `0x${BigInt(n).toString(16).padStart(40, "0")}`;
const now = Date.parse("2026-11-11T12:00:00Z");
const profile = (n: number, chainId = "ethereum") => ({chainId, tokenAddress: address(n), description: `Token ${n}`});
const pair = (n: number, changes = {}) => ({
  chainId: "ethereum", baseToken: {address: address(n)}, quoteToken: {address: address(999)},
  pairAddress: address(1000 + n), dexId: "fixture-dex", priceUsd: "0.25",
  liquidity: {usd: 20_000}, volume: {h24: 10_000, h1: 1000},
  txns: {h24: {buys: 20, sells: 10}}, pairCreatedAt: now - 2 * 3600000,
  priceChange: {h24: -2}, boosts: {active: 3}, ...changes,
});
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

function feed(profiles: unknown[], pairs: unknown[]) {
  vi.spyOn(Date, "now").mockReturnValue(now);
  const fetcher = vi.fn(async (input: string | URL | Request) => String(input).includes("token-profiles") ? json(profiles) : json(pairs));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function assertEvidence(result: Awaited<ReturnType<typeof getLatestTokens.execute>>) {
  expect(result).toMatchObject({schemaVersion: 1, rankingVersion: "profile-activity-v1"});
  expect(result.coverage.examinedCandidates).toBe(result.candidates.length);
  expect(result.coverage.source).toBe("Dexscreener latest profiles");
  expect(result.note).toContain("No safety or sellability verdict");
  expect(result.trending.every(token => token.eligible && token.trendScore !== null && token.exclusionReasons.length === 0)).toBe(true);
  for (const token of result.candidates) {
    expect(token.tokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(token.priceUSD === null || typeof token.priceUSD === "string").toBe(true);
    for (const value of [token.volume24h, token.volume1h, token.priceChange24h, token.liquidityUSD, token.trades24h, token.pairAgeHours]) {
      expect(value === null || typeof value === "number" && Number.isFinite(value)).toBe(true);
    }
  }
}

describe("Dexscreener tool structure", () => {
  it("exposes one profile discovery tool on Ethereum and Base", () => {
    expect(validateToolStructure(getLatestTokens)).toMatchObject({valid: true, errors: []});
    expect(dexscreenerTools().map(tool => tool.name)).toEqual(["getLatestTokens"]);
    expect(getLatestTokens.supportedChains?.map(chain => chain.id)).toEqual([1, 8453]);
    expect(getLatestTokens.description).toContain("missing evidence");
    expect(getLatestTokens.description).toContain("promotional");
  });

  it.each([999, 1.5, -1, Infinity, NaN])("rejects an unsupported or malformed chain %s before network access", async chainId => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getLatestTokens.execute(client, {chainId})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Dexscreener relative profile evidence", () => {
  it("reports numeric activity units, exact price strings, negative changes and promotion separately", async () => {
    feed([profile(1)], [pair(1)]);
    const result = await getLatestTokens.execute(client, {chainId: 1});
    assertEvidence(result);
    expect(result.complete).toBe(true);
    expect(result.trending).toHaveLength(1);
    expect(result.trending[0]).toMatchObject({priceUSD: "0.25", volume24h: 10_000, volume1h: 1000, liquidityUSD: 20_000, trades24h: 30, priceChange24h: -2, pairAgeHours: 2, activityAcceleration: 2.4, paidBoosts: 3, eligible: true});
    expect(typeof result.trending[0].trendScore).toBe("number");
  });

  it.each([[1, "ethereum"], [8453, "base"]] as const)("pins chain %i to %s while filtering foreign profiles", async (chainId, chainName) => {
    const fetcher = feed([profile(1, chainName), profile(2, chainName === "ethereum" ? "base" : "ethereum")], [pair(1, {chainId: chainName})]);
    const result = await getLatestTokens.execute(client, {chainId});
    expect(result.candidates.map(row => row.tokenAddress)).toEqual([address(1)]);
    expect(String(fetcher.mock.calls[1][0])).toBe(`https://api.dexscreener.com/tokens/v1/${chainName}/${address(1)}`);
  });

  it("chooses the deepest matching base-token pair rather than source order or quote-token price", async () => {
    feed([profile(1)], [
      pair(1, {priceUsd: "99", liquidity: {usd: 15_000}}),
      pair(2, {quoteToken: {address: address(1)}, priceUsd: "1000", liquidity: {usd: 1_000_000}}),
      pair(1, {pairAddress: address(2000), priceUsd: "0.50", liquidity: {usd: 50_000}}),
    ]);
    const result = await getLatestTokens.execute(client, {chainId: 1});
    expect(result.trending[0]).toMatchObject({pairAddress: address(2000), priceUSD: "0.50", liquidityUSD: 50_000});
  });

  it("keeps absent evidence unknown and excludes thin promoted activity from ranking", async () => {
    feed([profile(1), profile(2), profile(3)], [
      pair(1),
      pair(2, {liquidity: {usd: 100}, volume: {h24: 50, h1: 50}, txns: {h24: {buys: 2, sells: 1}}, boosts: {active: 1000}, priceChange: {h24: 100_000}}),
    ]);
    const result = await getLatestTokens.execute(client, {chainId: 1});
    assertEvidence(result);
    expect(result.trending.map(row => row.tokenAddress)).toEqual([address(1)]);
    expect(result.candidates.find(row => row.tokenAddress === address(2))).toMatchObject({eligible: false, trendScore: null, paidBoosts: 1000, exclusionReasons: expect.arrayContaining(["liquidityUSD below minimum", "volume24h below minimum", "trades24h below minimum"])});
    expect(result.candidates.find(row => row.tokenAddress === address(3))).toMatchObject({priceUSD: null, volume24h: null, priceChange24h: null, liquidityUSD: null, trendScore: null, eligible: false, exclusionReasons: expect.arrayContaining(["liquidityUSD unknown", "pairAgeHours unknown"])});
  });

  it("ranks eligible activity by score and uses token identity to resolve ties", async () => {
    feed([profile(3), profile(2), profile(1)], [pair(3), pair(2), pair(1, {liquidity: {usd: 100_000}, volume: {h24: 100_000, h1: 10_000}})]);
    const result = await getLatestTokens.execute(client, {chainId: 1});
    expect(result.trending.map(row => row.tokenAddress)).toEqual([address(1), address(2), address(3)]);
    expect(result.trending[0].trendScore).toBeGreaterThan(result.trending[1].trendScore);
    expect(result.trending[1].trendScore).toBe(result.trending[2].trendScore);
  });

  it("rejects a malformed profile envelope rather than reporting no candidates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({data: []})));
    await expect(getLatestTokens.execute(client, {chainId: 1})).rejects.toThrow(/coverage/);
  });

  it("preserves failed pair coverage as incomplete with unknown activity", async () => {
    vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("token-profiles") ? json([profile(1)]) : json({pairs: []})));
    const result = await getLatestTokens.execute(client, {chainId: 1});
    expect(result).toMatchObject({complete: false, trending: [], coverage: {examinedCandidates: 1}});
    expect(result.errors).toEqual([{addresses: [address(1)], message: expect.stringContaining("not verified empty")}]);
    expect(result.candidates[0]).toMatchObject({volume24h: null, priceUSD: null, eligible: false});
  });

  it("deduplicates identities and marks the bounded latest-profile sample as truncated", async () => {
    const profiles = Array.from({length: 61}, (_, i) => profile(i + 1));
    const fetcher = feed([profiles[0], ...profiles], []);
    const result = await getLatestTokens.execute(client, {chainId: 1});
    expect(result).toMatchObject({complete: false, coverage: {observedCandidates: 61, examinedCandidates: 60, truncated: true}});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.trending).toEqual([]);
  });
});

describe.skipIf(process.env.AGENTEK_OFFLINE_TESTS === "1")("Dexscreener live provider contracts", () => {
  it.each([1, 8453])("returns explicit sample coverage and ranking evidence for chain %i", async chainId => {
    const result = await withRetry(() => getLatestTokens.execute(client, {chainId}));
    assertEvidence(result);
    expect(result.chainId).toBe(chainId);
    expect(result.coverage.examinedCandidates).toBeLessThanOrEqual(60);
    expect(result.complete).toBe(result.errors.length === 0 && !result.coverage.truncated);
    for (let i = 1; i < result.trending.length; i++) {
      expect(result.trending[i - 1].trendScore).toBeGreaterThanOrEqual(result.trending[i].trendScore);
    }
  }, 30_000);

  it("recognizes the bare pair-array provider format for a known Ethereum token", async () => {
    const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const data = await providerJSON(`https://api.dexscreener.com/tokens/v1/ethereum/${weth}`, {}, "Dexscreener contract test failed");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.some(pair => pair.baseToken?.address?.toLowerCase() === weth.toLowerCase())).toBe(true);
    for (const pair of data) {
      expect(pair.chainId).toBe("ethereum");
      expect(pair.baseToken.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(pair.quoteToken.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  }, 15_000);
});
