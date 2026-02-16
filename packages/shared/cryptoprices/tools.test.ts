import { describe, it, expect } from "vitest";
import { getCryptoPriceTool } from "./tools.js";
import { cryptoPriceTools } from "./index.js";
import {
  createTestClient,
  validateToolStructure,
  withRetry,
} from "../test-helpers.js";

// Create a test client with real crypto price tools
const client = createTestClient(cryptoPriceTools());

describe("Crypto Price Tools", () => {
  describe("Tool Structure", () => {
    it("getCryptoPriceTool should have valid tool structure", () => {
      const result = validateToolStructure(getCryptoPriceTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getCryptoPriceTool should have correct name and description", () => {
      expect(getCryptoPriceTool.name).toBe("getCryptoPrice");
      expect(getCryptoPriceTool.description).toBe(
        "Get the current price of a cryptocurrency in USD"
      );
    });

    it("getCryptoPriceTool should require a symbol parameter", () => {
      expect(getCryptoPriceTool.parameters.shape).toHaveProperty("symbol");
    });

    it("cryptoPriceTools() should return the tool", () => {
      const tools = cryptoPriceTools();
      expect(tools).toHaveLength(1);
      expect(tools.map((t) => t.name)).toContain("getCryptoPrice");
    });
  });

  describe("getCryptoPriceTool - Real API Calls", () => {
    it("should fetch Bitcoin (BTC) price from CoinGecko", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "BTC" })
      );

      expect(result).toHaveProperty("symbol", "BTC");
      expect(result).toHaveProperty("currency", "USD");
      expect(result).toHaveProperty("source", "CoinGecko");
      expect(result).toHaveProperty("price");
      expect(result).toHaveProperty("timestamp");

      // BTC price should be a positive number (typically in thousands of USD)
      expect(typeof result.price).toBe("number");
      expect(result.price).toBeGreaterThan(0);

      // Timestamp should be a valid ISO string
      expect(() => new Date(result.timestamp)).not.toThrow();
    }, 15000);

    it("should fetch Ethereum (ETH) price from CoinGecko", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "ETH" })
      );

      expect(result).toHaveProperty("symbol", "ETH");
      expect(result).toHaveProperty("currency", "USD");
      expect(result).toHaveProperty("source", "CoinGecko");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should fetch Solana (SOL) price from CoinGecko", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "SOL" })
      );

      expect(result).toHaveProperty("symbol", "SOL");
      expect(result).toHaveProperty("currency", "USD");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should handle lowercase symbol input", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "btc" })
      );

      expect(result).toHaveProperty("symbol", "BTC");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should handle symbol with whitespace", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "  eth  " })
      );

      expect(result).toHaveProperty("symbol", "ETH");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should fetch DOGE price", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "DOGE" })
      );

      expect(result).toHaveProperty("symbol", "DOGE");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should fetch LINK (Chainlink) price", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "LINK" })
      );

      expect(result).toHaveProperty("symbol", "LINK");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should fetch AVAX price using symbol mapping", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "AVAX" })
      );

      expect(result).toHaveProperty("symbol", "AVAX");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should fetch ARB (Arbitrum) price", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "ARB" })
      );

      expect(result).toHaveProperty("symbol", "ARB");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should accept CoinGecko ID directly (bitcoin)", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "bitcoin" })
      );

      // When using CoinGecko ID directly, symbol will be uppercased
      expect(result).toHaveProperty("symbol", "BITCOIN");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);

    it("should accept CoinGecko ID directly (ethereum)", async () => {
      const result = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "ethereum" })
      );

      expect(result).toHaveProperty("symbol", "ETHEREUM");
      expect(result.price).toBeGreaterThan(0);
    }, 15000);
  });

  describe("getCryptoPriceTool - Error Handling", () => {
    it("should throw error for non-existent cryptocurrency", async () => {
      await expect(
        getCryptoPriceTool.execute(client, {
          symbol: "THISCRYPTODOESNOTEXIST123456",
        })
      ).rejects.toThrow(/Price data not found/);
    }, 15000);

    it("should throw error for empty symbol", async () => {
      await expect(
        getCryptoPriceTool.execute(client, { symbol: "" })
      ).rejects.toThrow();
    }, 15000);
  });

  describe("Price Consistency", () => {
    it("BTC and bitcoin should return similar prices", async () => {
      const btcResult = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "BTC" })
      );

      const bitcoinResult = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "bitcoin" })
      );

      // Prices should be within 1% of each other (accounting for slight time difference)
      const priceDiff = Math.abs(btcResult.price - bitcoinResult.price);
      const avgPrice = (btcResult.price + bitcoinResult.price) / 2;
      const percentDiff = (priceDiff / avgPrice) * 100;

      expect(percentDiff).toBeLessThan(1);
    }, 30000);

    it("ETH and ethereum should return similar prices", async () => {
      const ethResult = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "ETH" })
      );

      const ethereumResult = await withRetry(() =>
        getCryptoPriceTool.execute(client, { symbol: "ethereum" })
      );

      const priceDiff = Math.abs(ethResult.price - ethereumResult.price);
      const avgPrice = (ethResult.price + ethereumResult.price) / 2;
      const percentDiff = (priceDiff / avgPrice) * 100;

      expect(percentDiff).toBeLessThan(1);
    }, 30000);
  });

  describe("Multiple Cryptocurrencies", () => {
    it("should fetch prices for multiple major cryptocurrencies", async () => {
      const symbols = ["BTC", "ETH", "SOL", "DOGE", "LINK"];
      const results = await Promise.all(
        symbols.map((symbol) =>
          withRetry(() => getCryptoPriceTool.execute(client, { symbol }))
        )
      );

      // All should succeed
      expect(results).toHaveLength(5);

      // All should have valid price data
      results.forEach((result, index) => {
        expect(result).toHaveProperty("symbol", symbols[index]);
        expect(result).toHaveProperty("price");
        expect(result.price).toBeGreaterThan(0);
        expect(result).toHaveProperty("currency", "USD");
        expect(result).toHaveProperty("source", "CoinGecko");
      });

      // BTC should typically be more expensive than ETH
      const btcPrice = results[0].price;
      const ethPrice = results[1].price;
      expect(btcPrice).toBeGreaterThan(ethPrice);
    }, 60000);
  });
});
