import { describe, it, expect } from "vitest";
import {
  getTokenChartTool,
  getYieldTool,
  compareYieldTool,
  getYieldHistoryTool,
  compareYieldHistoryTool,
} from "./tools.js";
import { defillamaTools } from "./index.js";
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
      expect(tools).toHaveLength(5);
      expect(tools.map((t) => t.name)).toContain("getTokenChart");
      expect(tools.map((t) => t.name)).toContain("getYieldTool");
      expect(tools.map((t) => t.name)).toContain("compareYieldTool");
      expect(tools.map((t) => t.name)).toContain("getYieldHistoryTool");
      expect(tools.map((t) => t.name)).toContain("compareYieldHistoryTool");
    });

    it("should have unique tool names", () => {
      const tools = defillamaTools();
      const toolNames = tools.map((tool) => tool.name);
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe("getTokenChartTool", () => {
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

  describe("getYieldTool", () => {
    it("should fetch yield data without filters", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, { limit: 10 })
      );

      expect(result.count).toBeGreaterThan(0);
      expect(result.count).toBeLessThanOrEqual(10);
      expect(result.yields).toBeDefined();
      expect(Array.isArray(result.yields)).toBe(true);

      // Verify yield data structure
      const firstYield = result.yields[0];
      expect(firstYield).toHaveProperty("project");
      expect(firstYield).toHaveProperty("asset");
      expect(firstYield).toHaveProperty("chain");
      expect(firstYield).toHaveProperty("apy");
      expect(firstYield).toHaveProperty("tvl");
      expect(firstYield).toHaveProperty("risk");
    }, LONG_TIMEOUT);

    it("should filter by chain (Ethereum)", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          chain: "Ethereum",
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.chain.toLowerCase()).toContain("ethereum");
      });
    }, LONG_TIMEOUT);

    it("should filter by stablecoin yields", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          stablecoin: true,
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.stablecoin).toBe("Yes");
      });
    }, LONG_TIMEOUT);

    it("should filter by minimum APY", async () => {
      const minApy = 5;
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          minApy,
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        const apyValue = parseFloat(y.apy.replace("%", ""));
        expect(apyValue).toBeGreaterThanOrEqual(minApy);
      });
    }, LONG_TIMEOUT);

    it("should filter by protocol (Aave)", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          protocol: "Aave",
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.protocol).toBe("Aave");
      });
    }, LONG_TIMEOUT);

    it("should filter by project name", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          project: "lido",
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.project.toLowerCase()).toContain("lido");
      });
    }, LONG_TIMEOUT);

    it("should filter by symbol", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          symbol: "USDC",
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.asset.toLowerCase()).toContain("usdc");
      });
    }, LONG_TIMEOUT);

    it("should filter by max risk level", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          maxRisk: "low",
          limit: 10,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.risk).toBe("low");
      });
    }, LONG_TIMEOUT);

    it("should sort yields by APY in descending order", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          limit: 20,
        })
      );

      expect(result.count).toBeGreaterThan(1);
      const apyValues = result.yields.map((y) =>
        parseFloat(y.apy.replace("%", ""))
      );

      // Check that APYs are in descending order
      for (let i = 1; i < apyValues.length; i++) {
        expect(apyValues[i - 1]).toBeGreaterThanOrEqual(apyValues[i]);
      }
    }, LONG_TIMEOUT);

    it("should include pool IDs for yield entries", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, {
          limit: 5,
        })
      );

      expect(result.count).toBeGreaterThan(0);
      result.yields.forEach((y) => {
        expect(y.pool).toBeDefined();
        expect(typeof y.pool).toBe("string");
      });
    }, LONG_TIMEOUT);
  });

  describe("compareYieldTool", () => {
    it("should compare yields for a single asset", async () => {
      const result = await withRetry(() =>
        compareYieldTool.execute(client, {
          assets: ["USDC"],
        })
      );

      expect(result.comparisons).toBeDefined();
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].asset).toBe("USDC");
      expect(result.comparisons[0].protocols).toBeDefined();
      expect(Array.isArray(result.comparisons[0].protocols)).toBe(true);
    }, LONG_TIMEOUT);

    it("should compare yields for multiple assets", async () => {
      const result = await withRetry(() =>
        compareYieldTool.execute(client, {
          assets: ["USDC", "ETH"],
        })
      );

      expect(result.comparisons).toHaveLength(2);
      expect(result.comparisons.map((c) => c.asset)).toContain("USDC");
      expect(result.comparisons.map((c) => c.asset)).toContain("ETH");
    }, LONG_TIMEOUT);

    it("should calculate projected earnings when amount and duration provided", async () => {
      const result = await withRetry(() =>
        compareYieldTool.execute(client, {
          assets: ["USDC"],
          amount: 10000,
          duration: 365,
        })
      );

      expect(result.investmentDetails).toBeDefined();
      expect(result.investmentDetails?.initialAmount).toBe("$10,000.00");
      expect(result.investmentDetails?.duration).toBe("365 days");

      // Check that projected earnings are calculated
      const protocols = result.comparisons[0].protocols;
      if (protocols.length > 0) {
        expect(protocols[0]).toHaveProperty("projectedEarnings");
        expect(protocols[0]).toHaveProperty("totalValue");
      }
    }, LONG_TIMEOUT);

    it("should return top 5 yields per asset", async () => {
      const result = await withRetry(() =>
        compareYieldTool.execute(client, {
          assets: ["ETH"],
        })
      );

      expect(result.comparisons[0].protocols.length).toBeLessThanOrEqual(5);
    }, LONG_TIMEOUT);

    it("should include risk assessment for each protocol", async () => {
      const result = await withRetry(() =>
        compareYieldTool.execute(client, {
          assets: ["USDC"],
        })
      );

      const protocols = result.comparisons[0].protocols;
      protocols.forEach((p) => {
        expect(p).toHaveProperty("risk");
        expect(["low", "medium", "high"]).toContain(p.risk);
      });
    }, LONG_TIMEOUT);
  });

  describe("getYieldHistoryTool", () => {
    // We need a known pool ID for testing. Let's first get one from the yield tool.
    let testPoolId: string;

    it("should fetch pool ID for subsequent tests", async () => {
      const yieldResult = await withRetry(() =>
        getYieldTool.execute(client, {
          project: "aave",
          chain: "Ethereum",
          limit: 1,
        })
      );

      expect(yieldResult.count).toBeGreaterThan(0);
      testPoolId = yieldResult.yields[0].pool;
      expect(testPoolId).toBeDefined();
    }, LONG_TIMEOUT);

    it("should fetch historical yield data for a pool", async () => {
      // Use a well-known Aave USDC pool ID
      const result = await withRetry(() =>
        getYieldHistoryTool.execute(client, {
          poolId: testPoolId || "747c1d2a-c668-4682-b9f9-296708a3dd90", // Fallback to known Aave V3 USDC pool
          days: 7,
        })
      );

      expect(result.poolId).toBeDefined();
      expect(result.period).toBe("7 days");
      expect(result.dataPoints).toBeGreaterThan(0);

      // Check current data
      expect(result.current).toBeDefined();
      expect(result.current.apy).toBeDefined();
      expect(result.current.tvl).toBeDefined();
      expect(result.current.date).toBeDefined();

      // Check statistics
      expect(result.statistics).toBeDefined();
      expect(result.statistics.apy).toBeDefined();
      expect(result.statistics.apy.average).toBeDefined();
      expect(result.statistics.apy.min).toBeDefined();
      expect(result.statistics.apy.max).toBeDefined();
      expect(result.statistics.apy.volatility).toBeDefined();

      expect(result.statistics.tvl).toBeDefined();
      expect(result.statistics.tvl.average).toBeDefined();
    }, LONG_TIMEOUT);

    it("should return timeline data", async () => {
      const result = await withRetry(() =>
        getYieldHistoryTool.execute(client, {
          poolId: testPoolId || "747c1d2a-c668-4682-b9f9-296708a3dd90",
          days: 7,
        })
      );

      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline)).toBe(true);
      if (result.timeline.length > 0) {
        const timelinePoint = result.timeline[0];
        expect(timelinePoint).toHaveProperty("date");
        expect(timelinePoint).toHaveProperty("apy");
        expect(timelinePoint).toHaveProperty("tvl");
      }
    }, LONG_TIMEOUT);

    it("should respect the days parameter", async () => {
      const result30 = await withRetry(() =>
        getYieldHistoryTool.execute(client, {
          poolId: testPoolId || "747c1d2a-c668-4682-b9f9-296708a3dd90",
          days: 30,
        })
      );

      const result7 = await withRetry(() =>
        getYieldHistoryTool.execute(client, {
          poolId: testPoolId || "747c1d2a-c668-4682-b9f9-296708a3dd90",
          days: 7,
        })
      );

      expect(result30.period).toBe("30 days");
      expect(result7.period).toBe("7 days");
      // Generally more data points for longer periods
      expect(result30.dataPoints).toBeGreaterThanOrEqual(result7.dataPoints);
    }, LONG_TIMEOUT);

    it("should throw error for invalid pool ID", async () => {
      await expect(
        getYieldHistoryTool.execute(client, {
          poolId: "invalid-pool-id-that-does-not-exist",
          days: 7,
        })
      ).rejects.toThrow();
    }, LONG_TIMEOUT);
  });

  describe("compareYieldHistoryTool", () => {
    let testPoolIds: string[] = [];

    it("should fetch pool IDs for subsequent tests", async () => {
      // Get multiple pool IDs from Aave on different chains
      const ethereumPools = await withRetry(() =>
        getYieldTool.execute(client, {
          project: "aave",
          chain: "Ethereum",
          limit: 2,
        })
      );

      testPoolIds = ethereumPools.yields.map((y) => y.pool).filter(Boolean);
      expect(testPoolIds.length).toBeGreaterThanOrEqual(2);
    }, LONG_TIMEOUT);

    it("should compare historical yield data for multiple pools", async () => {
      const poolsToCompare = testPoolIds.length >= 2
        ? testPoolIds.slice(0, 2)
        : ["747c1d2a-c668-4682-b9f9-296708a3dd90", "825688c0-c694-4a6b-8497-177e425b7348"]; // Fallback Aave pools

      const result = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 7,
          sortBy: "apy",
        })
      );

      expect(result.count).toBe(poolsToCompare.length);
      expect(result.period).toBe("7 days");
      expect(result.sortedBy).toBe("apy");

      // Check bestFor recommendations
      expect(result.bestFor).toBeDefined();
      expect(result.bestFor.highestAvgApy).toBeDefined();
      expect(result.bestFor.lowestVolatility).toBeDefined();
      expect(result.bestFor.bestStability).toBeDefined();

      // Check pools data
      expect(result.pools).toBeDefined();
      expect(Array.isArray(result.pools)).toBe(true);
      expect(result.pools.length).toBe(poolsToCompare.length);

      const firstPool = result.pools[0];
      expect(firstPool).toHaveProperty("poolId");
      expect(firstPool).toHaveProperty("name");
      expect(firstPool).toHaveProperty("currentApy");
      expect(firstPool).toHaveProperty("avgApy");
      expect(firstPool).toHaveProperty("volatility");
      expect(firstPool).toHaveProperty("stabilityScore");
    }, LONG_TIMEOUT);

    it("should sort by different metrics", async () => {
      const poolsToCompare = testPoolIds.length >= 2
        ? testPoolIds.slice(0, 2)
        : ["747c1d2a-c668-4682-b9f9-296708a3dd90", "825688c0-c694-4a6b-8497-177e425b7348"];

      const resultByApy = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 7,
          sortBy: "apy",
        })
      );

      const resultByVolatility = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 7,
          sortBy: "volatility",
        })
      );

      const resultByStability = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 7,
          sortBy: "stability",
        })
      );

      expect(resultByApy.sortedBy).toBe("apy");
      expect(resultByVolatility.sortedBy).toBe("volatility");
      expect(resultByStability.sortedBy).toBe("stability");
    }, LONG_TIMEOUT);

    it("should include APY and volatility rankings", async () => {
      const poolsToCompare = testPoolIds.length >= 2
        ? testPoolIds.slice(0, 2)
        : ["747c1d2a-c668-4682-b9f9-296708a3dd90", "825688c0-c694-4a6b-8497-177e425b7348"];

      const result = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 7,
        })
      );

      result.pools.forEach((pool) => {
        expect(pool.apyRank).toBeDefined();
        expect(pool.volatilityRank).toBeDefined();
        expect(pool.apyRank).toBeGreaterThan(0);
        expect(pool.apyRank).toBeLessThanOrEqual(poolsToCompare.length);
      });
    }, LONG_TIMEOUT);

    it("should include detailed statistics in response", async () => {
      const poolsToCompare = testPoolIds.length >= 2
        ? testPoolIds.slice(0, 2)
        : ["747c1d2a-c668-4682-b9f9-296708a3dd90", "825688c0-c694-4a6b-8497-177e425b7348"];

      const result = await withRetry(() =>
        compareYieldHistoryTool.execute(client, {
          poolIds: poolsToCompare,
          days: 14,
        })
      );

      expect(result.details).toBeDefined();
      expect(Array.isArray(result.details)).toBe(true);

      const detail = result.details[0];
      expect(detail).toHaveProperty("poolId");
      expect(detail).toHaveProperty("current");
      expect(detail).toHaveProperty("statistics");
      expect(detail).toHaveProperty("performance");
      expect(detail.statistics.apy).toHaveProperty("average");
      expect(detail.statistics.apy).toHaveProperty("volatility");
    }, LONG_TIMEOUT);
  });

  describe("API Error Handling", () => {
    it("should handle invalid token format gracefully in getTokenChartTool", async () => {
      // Invalid format should still attempt to fetch but may fail
      await expect(
        getTokenChartTool.execute(client, {
          tokens: "invalid_format",
          period: "1d",
        })
      ).rejects.toThrow();
    }, LONG_TIMEOUT);

    it("should handle empty assets array in compareYieldTool", async () => {
      // Zod validation should catch this
      await expect(
        compareYieldTool.execute(client, {
          assets: [],
        })
      ).rejects.toThrow();
    });
  });

  describe("Data Validation", () => {
    it("should return valid APY percentages", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, { limit: 10 })
      );

      result.yields.forEach((y) => {
        expect(y.apy).toMatch(/^-?\d+\.?\d*%$/);
      });
    }, LONG_TIMEOUT);

    it("should return valid TVL values", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, { limit: 10 })
      );

      result.yields.forEach((y) => {
        expect(y.tvl).toMatch(/^\$[\d,]+\.\d{2}$/);
      });
    }, LONG_TIMEOUT);

    it("should return valid risk levels", async () => {
      const result = await withRetry(() =>
        getYieldTool.execute(client, { limit: 10 })
      );

      const validRiskLevels = ["low", "medium", "high"];
      result.yields.forEach((y) => {
        expect(validRiskLevels).toContain(y.risk);
      });
    }, LONG_TIMEOUT);
  });
});
