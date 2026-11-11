import { afterEach, describe, it, expect, vi } from "vitest";
import {
  getTokenChartTool,
  getYieldTool,
  compareYieldTool,
  getYieldHistoryTool,
  compareYieldHistoryTool,
} from "./tools.js";
import { defillamaTools } from "./index.js";
import * as api from "./utils/api.js";
import {
  createTestClient,
  validateToolStructure,
  withRetry,
} from "../test-helpers.js";

// Create a test client with real DeFiLlama tools
const client = createTestClient(defillamaTools());

// Increase timeout for API calls
const LONG_TIMEOUT = 30000;

describe("DeFiLlama Tools", () => {
  describe("Tool Structure", () => {
    it("getTokenChartTool should have valid tool structure", () => {
      const result = validateToolStructure(getTokenChartTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getYieldTool should have valid tool structure", () => {
      const result = validateToolStructure(getYieldTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("compareYieldTool should have valid tool structure", () => {
      const result = validateToolStructure(compareYieldTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getYieldHistoryTool should have valid tool structure", () => {
      const result = validateToolStructure(getYieldHistoryTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("compareYieldHistoryTool should have valid tool structure", () => {
      const result = validateToolStructure(compareYieldHistoryTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("defillamaTools() should return all tools", () => {
      const tools = defillamaTools();
      expect(tools).toHaveLength(6);
      expect(tools.map((t) => t.name)).toContain("getTokenChart");
      expect(tools.map((t) => t.name)).toContain("getYieldTool");
      expect(tools.map((t) => t.name)).toContain("compareYieldTool");
      expect(tools.map((t) => t.name)).toContain("getYieldHistoryTool");
      expect(tools.map((t) => t.name)).toContain("compareYieldHistoryTool");
      expect(tools.map((t) => t.name)).toContain("getYieldPoolEvidence");
    });

    it("should have unique tool names", () => {
      const tools = defillamaTools();
      const toolNames = tools.map((tool) => tool.name);
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe.skipIf(process.env.AGENTEK_OFFLINE_TESTS === "1")("getTokenChartTool", () => {
    it("should fetch price chart data for ETH", async () => {
      const result = await withRetry(() =>
        getTokenChartTool.execute(client, {
          tokens: "coingecko:ethereum",
          period: "1d",
          options: { span: 5 },
        })
      );

      expect(result.success).toBe(true);
      expect(result.tokens).toContain("coingecko:ethereum");
      expect(result.period).toBe("1d");
      expect(result.coins).toBeDefined();
      expect(result.coins["coingecko:ethereum"]).toBeDefined();
      expect(result.coins["coingecko:ethereum"].prices).toBeDefined();
      expect(Array.isArray(result.coins["coingecko:ethereum"].prices)).toBe(true);
    }, LONG_TIMEOUT);

    it("should fetch price chart data for multiple tokens", async () => {
      const result = await withRetry(() =>
        getTokenChartTool.execute(client, {
          tokens: ["coingecko:ethereum", "coingecko:bitcoin"],
          period: "1d",
          options: { span: 3 },
        })
      );

      expect(result.success).toBe(true);
      expect(result.tokens).toHaveLength(2);
      expect(result.coins).toBeDefined();
    }, LONG_TIMEOUT);

    it("should fetch chart data with custom span", async () => {
      const result = await withRetry(() =>
        getTokenChartTool.execute(client, {
          tokens: "coingecko:ethereum",
          period: "4h",
          options: { span: 10 },
        })
      );

      expect(result.success).toBe(true);
      const prices = result.coins["coingecko:ethereum"]?.prices;
      if (prices && prices.length > 0) {
        expect(prices.length).toBeLessThanOrEqual(10);
      }
    }, LONG_TIMEOUT);

    it("should handle Ethereum contract address format", async () => {
      // USDC on Ethereum
      const result = await withRetry(() =>
        getTokenChartTool.execute(client, {
          tokens: "ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          period: "1d",
          options: { span: 3 },
        })
      );

      expect(result.success).toBe(true);
      expect(result.tokens).toContain("ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    }, LONG_TIMEOUT);
  });

  describe("yield evidence semantics", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const pool = (id: string, changes = {}) => ({
      pool: id, chain: "Ethereum", project: "aave-v3", symbol: "USDC", apy: 4,
      apyBase: 3, apyReward: 1, tvlUsd: 2_000_000, stablecoin: true,
      ilRisk: "no", exposure: "single", rewardTokens: null, ...changes,
    });
    const catalogue = () => Object.freeze([
      Object.freeze(pool("small-high-rate", {apy: 20, tvlUsd: 50_000, project: "other"})),
      Object.freeze(pool("large-low-rate")),
      Object.freeze(pool("missing", {apy: null, tvlUsd: null, stablecoin: undefined})),
      Object.freeze(pool("base-pool", {chain: "Base", apy: 8, tvlUsd: 3_000_000})),
    ]);
    const listed = () => vi.spyOn(api, "fetchDefiLlamaPools").mockResolvedValue({status: "success", data: catalogue()} as any);
    const point = (daysAgo: number, apy: number | null, tvlUsd = 2_000_000) => ({
      timestamp: new Date(now - daysAgo * 86400000).toISOString(), apy, tvlUsd, apyBase: apy, apyReward: null,
    });
    afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

    it("uses liquidity as the default order and keeps rates, units and risk distinct", async () => {
      listed();
      const result = await getYieldTool.execute(client, {chainId: 1});
      expect(result.ranking).toContain("liquidity descending");
      expect(result.yields.map(p => p.pool)).toEqual(["large-low-rate", "small-high-rate", "missing"]);
      expect(result.yields[0]).toMatchObject({project: "aave-v3", stablecoin: true, apy: "4.00%", apyPercent: 4, tvl: "$2000000.00", tvlUsd: 2_000_000, risk: "unverified", contractsVerified: false, sourceUpdatedAt: null});
      expect(result.yields[0].execution).toMatchObject({deposit: "unverified", withdrawal: "unverified"});
      expect(result.yields[2]).toMatchObject({apy: null, apyPercent: null, tvl: null, tvlUsd: null, stablecoin: null, risk: "unverified"});
      expect(result.yields[2].warnings).toEqual(expect.arrayContaining(["APY unavailable.", "Liquidity unavailable."]));
    });

    it("filters exact network, protocol project, stablecoin boolean and percentage-point APY", async () => {
      listed();
      const result = await getYieldTool.execute(client, {chainId: 1, protocol: "Aave", stablecoin: true, minApy: 3, minTvl: 1_000_000});
      expect(result.yields.map(p => p.pool)).toEqual(["large-low-rate"]);
      expect(result).toMatchObject({requestedChainId: 1, requestedChain: "ethereum", count: 1});
      expect(result.yields[0].project).toBe("aave-v3");
      expect(result.yields[0].risk).toBe("unverified");
    });

    it("treats maxRisk as a legacy APY screen and explicit APY sort as a rate ranking", async () => {
      listed();
      const screened = await getYieldTool.execute(client, {chainId: 1, maxRisk: "low"});
      expect(screened.yields.map(p => p.pool)).toEqual(["large-low-rate"]);
      expect(screened.yields[0].risk).toBe("unverified");
      const sorted = await getYieldTool.execute(client, {chainId: 1, sortBy: "apy"});
      expect(sorted.yields.map(p => p.pool)).toEqual(["small-high-rate", "large-low-rate", "missing"]);
      expect(sorted.ranking).toContain("not risk-adjusted");
    });

    it("rejects conflicting networks and invalid runtime inputs before provider reads", async () => {
      const fetchPools = listed();
      for (const args of [{chainId: 1, chain: "Base"}, {chainId: 999}, {limit: 0}, {minApy: Infinity}]) {
        await expect(getYieldTool.execute(client, args)).rejects.toThrow();
      }
      await expect(compareYieldTool.execute(client, {assets: []})).rejects.toThrow();
      expect(fetchPools).not.toHaveBeenCalled();
    });

    it("compares yields with numeric gross projections while preserving unknown returns", async () => {
      listed();
      const result = await compareYieldTool.execute(client, {chainId: 1, assets: ["USDC"], amount: 10_000, duration: 365});
      expect(result.comparisons).toHaveLength(1);
      const comparison = result.comparisons[0];
      expect(comparison.asset).toBe("USDC");
      expect(comparison.yields).toHaveLength(3);
      expect(comparison.yields[0].grossProjectedEarnings).toBeCloseTo(400, 8);
      expect(comparison.yields[2].grossProjectedEarnings).toBeNull();
      expect(result.warning).toContain("No net return estimate");
      expect(result.warning).toContain("fees");
      expect(comparison.yields.every(p => p.risk === "unverified")).toBe(true);
    });

    it("uses dated APY observations, preserves missing points, and reports percentage-point volatility", async () => {
      listed(); vi.spyOn(Date, "now").mockReturnValue(now);
      vi.spyOn(api, "fetchPoolHistoricalData").mockResolvedValue({status: "success", data: [point(-1, 100), point(1, 4), point(10, 50), point(3, 2), point(2, null)]} as any);
      const result = await getYieldHistoryTool.execute(client, {poolId: "large-low-rate", chainId: 1, days: 7});
      expect(result).toMatchObject({poolId: "large-low-rate", chainId: 1, requestedDays: 7, dataPoints: 2, missingApyPoints: 1, averageApy: 3, minApy: 2, maxApy: 4, volatility: 1});
      expect(result.timeline.map(p => p.apy)).toEqual([2, null, 4]);
      expect(result.timeline.map(p => p.tvlUsd)).toEqual([2_000_000, 2_000_000, 2_000_000]);
      expect(result.firstObservation).toBe(point(3, 2).timestamp);
      expect(result.lastObservation).toBe(point(1, 4).timestamp);
    });

    it("keeps one observation insufficient for volatility and rejects a wrong-chain pool", async () => {
      listed(); vi.spyOn(Date, "now").mockReturnValue(now);
      const chart = vi.spyOn(api, "fetchPoolHistoricalData").mockResolvedValue({status: "success", data: [point(1, 4)]} as any);
      await expect(getYieldHistoryTool.execute(client, {poolId: "large-low-rate", chainId: 1, days: 7})).resolves.toMatchObject({dataPoints: 1, volatility: null});
      chart.mockClear();
      await expect(getYieldHistoryTool.execute(client, {poolId: "base-pool", chainId: 1, days: 7})).rejects.toThrow(/network/);
      expect(chart).not.toHaveBeenCalled();
    });

    it("preserves failed histories and ranks available evidence without invented safety scores", async () => {
      listed(); vi.spyOn(Date, "now").mockReturnValue(now);
      vi.spyOn(api, "fetchPoolHistoricalData").mockImplementation(async id => {
        if (id === "missing") throw new Error("History unavailable");
        return {status: "success", data: id === "large-low-rate" ? [point(2, 2), point(1, 4)] : [point(2, 10), point(1, 10)]} as any;
      });
      const ids = ["large-low-rate", "small-high-rate", "missing"];
      const volatility = await compareYieldHistoryTool.execute(client, {chainId: 1, poolIds: ids, days: 7});
      expect(volatility).toMatchObject({ranking: "volatility", complete: false});
      expect(volatility.results.map(p => p.poolId)).toEqual(["small-high-rate", "large-low-rate"]);
      expect(volatility.errors).toEqual([{poolId: "missing", error: expect.stringContaining("History unavailable")}]);
      expect(volatility).not.toHaveProperty("bestFor");
      expect(volatility.results[0]).not.toHaveProperty("stabilityScore");
      const apy = await compareYieldHistoryTool.execute(client, {chainId: 1, poolIds: ids.slice(0, 2), days: 7, sortBy: "apy"});
      expect(apy.complete).toBe(true);
      expect(apy.results.map(p => p.averageApy)).toEqual([10, 3]);
    });
  });

  describe.skipIf(process.env.AGENTEK_OFFLINE_TESTS === "1")("live yield evidence", () => {
    it("returns source-listed candidates with explicit units and unverified execution", async () => {
      const result = await withRetry(() => getYieldTool.execute(client, {chainId: 1, protocol: "Aave", stablecoin: true, limit: 5}));
      expect(result.count).toBeGreaterThan(0);
      expect(result.count).toBe(result.yields.length);
      expect(result.requestedChainId).toBe(1);
      const tvls = result.yields.map(row => row.tvlUsd ?? -Infinity);
      expect(tvls).toEqual([...tvls].sort((a, b) => b - a));
      for (const row of result.yields) {
        expect(row.chainId).toBe(1);
        expect(row.project.toLowerCase()).toContain("aave");
        expect(row.stablecoin).toBe(true);
        expect(row.risk).toBe("unverified");
        expect(row.execution).toMatchObject({deposit: "unverified", withdrawal: "unverified"});
        expect(row.apy).toBe(row.apyPercent === null ? null : `${row.apyPercent.toFixed(2)}%`);
        expect(row.tvl).toBe(row.tvlUsd === null ? null : `$${row.tvlUsd.toFixed(2)}`);
      }
    }, LONG_TIMEOUT);

    it("reports available history and failures for the selected source pool identities", async () => {
      const source = await withRetry(() => getYieldTool.execute(client, {chainId: 1, project: "aave", limit: 2}));
      const poolIds = source.yields.map(row => row.pool);
      expect(poolIds).toHaveLength(2);
      const result = await withRetry(() => compareYieldHistoryTool.execute(client, {chainId: 1, poolIds, days: 7, sortBy: "apy"}));
      expect(result.ranking).toBe("apy");
      expect(result.results.length + result.errors.length).toBe(poolIds.length);
      expect(result.complete).toBe(result.errors.length === 0);
      expect([...result.results.map(row => row.poolId), ...result.errors.map(row => row.poolId)].sort()).toEqual([...poolIds].sort());
      for (const row of result.results) {
        expect(row.chainId).toBe(1);
        expect(row.requestedDays).toBe(7);
        expect(row.dataPoints).toBeGreaterThan(0);
        expect(Number.isFinite(row.averageApy)).toBe(true);
        expect(row.timeline.every(point => Number.isFinite(Date.parse(point.timestamp)))).toBe(true);
      }
    }, LONG_TIMEOUT);
  });
});
