import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCryptoPriceTool } from "./tools.js";
import type { AgentekClient } from "../client.js";

describe("getCryptoPriceTool", () => {
  const mockClient = {} as AgentekClient;
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it("should have the correct name and description", () => {
    expect(getCryptoPriceTool.name).toBe("getCryptoPrice");
    expect(getCryptoPriceTool.description).toBe("Get the current price of a cryptocurrency in USD");
  });
  
  it("should require a symbol parameter", () => {
    expect(getCryptoPriceTool.parameters.shape).toHaveProperty("symbol");
  });
  
  it("should call CoinGecko API and return price data", async () => {
    const mockResponse = {
      bitcoin: { usd: 60000 }
    };
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse)
    }) as any;
    
    const result = await getCryptoPriceTool.execute(mockClient, { symbol: "BTC" });
    
    expect(fetch).toHaveBeenCalledWith(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    
    expect(result).toEqual({
      symbol: "BTC",
      price: 60000,
      currency: "USD",
      timestamp: expect.any(String),
      source: "CoinGecko"
    });
  });
  
  it("should handle API errors gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests"
    }) as any;
    
    await expect(getCryptoPriceTool.execute(mockClient, { symbol: "BTC" }))
      .rejects
      .toThrow("Error fetching price for BTC: CoinGecko API error: 429 Too Many Requests");
  });
  
  it("should throw an error when price data is not found", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({})
    }) as any;
    
    await expect(getCryptoPriceTool.execute(mockClient, { symbol: "UNKNOWN" }))
      .rejects
      .toThrow("Error fetching price for UNKNOWN: Price data not found for UNKNOWN");
  });
});