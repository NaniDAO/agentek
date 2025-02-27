import { createToolCollection } from "../client";
import type { BaseTool } from "../client";
import { createMarketEventsTool } from "./tools";

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
