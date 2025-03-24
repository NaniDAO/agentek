import { z } from "zod";
import { createTool } from "../client.js";

export const getCryptoPriceTool = createTool({
  name: "getCryptoPrice",
  description: "Get the current price of a cryptocurrency in USD",
  parameters: z.object({
    symbol: z.string().describe("Cryptocurrency symbol (e.g., BTC, ETH, SOL) or CoinGecko ID (e.g., bitcoin, ethereum, solana) for better accuracy and wider asset support")
  }),
  execute: async (_client, args) => {
    const { symbol } = args;
    const normalizedSymbol = symbol.toUpperCase().trim();
    
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${mapSymbolToId(normalizedSymbol)}&vs_currencies=usd`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const id = mapSymbolToId(normalizedSymbol);
      
      if (!data[id]) {
        throw new Error(`Price data not found for ${normalizedSymbol}`);
      }
      
      return {
        symbol: normalizedSymbol,
        price: data[id].usd,
        currency: "USD",
        timestamp: new Date().toISOString(),
        source: "CoinGecko"
      };
    } catch (error) {
      throw new Error(`Error fetching price for ${normalizedSymbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

// Map common symbols to CoinGecko IDs
function mapSymbolToId(symbol: string): string {
  const mapping: Record<string, string> = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "AVAX": "avalanche-2",
    "MATIC": "matic-network",
    "BNB": "binancecoin",
    "DOT": "polkadot",
    "ADA": "cardano",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "SHIB": "shiba-inu",
    "ARB": "arbitrum",
    "OP": "optimism",
    "LINK": "chainlink",
    "UNI": "uniswap",
    "AAVE": "aave",
  };
  
  return mapping[symbol] || symbol.toLowerCase();
}