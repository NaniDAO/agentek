import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";
import { createMarketEventsTool } from "./tools.js";

export function createCoinMarketCalTools({
  coinMarketCalApiKey,
}: {
  coinMarketCalApiKey: string;
}): BaseTool[] {
  if (!coinMarketCalApiKey) {
    throw new Error("CoinMarketCal API key is required for using these tools.");
  }

  return createToolCollection([createMarketEventsTool(coinMarketCalApiKey)]);
}
