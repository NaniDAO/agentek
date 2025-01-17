import {
  BaseTool,
  createToolCollection,
  createTool,
  AgentekClient,
} from "../client";
import { z } from "zod";

const getLatestTokensParameters = z.object({});

const getLatestTokens = createTool({
  name: "getLatestTokens",
  description: "Get trending tokens and market data",
  parameters: getLatestTokensParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof getLatestTokensParameters>,
  ) => {
    try {
      const profileResponse = await fetch(
        "https://api.dexscreener.com/token-profiles/latest/v1",
      );
      const profileData = await profileResponse.json();

      const tokenAddresses = profileData
        .map((token: { tokenAddress: string }, index: number, array: any[]) =>
          index === array.length - 1
            ? token.tokenAddress
            : token.tokenAddress + ",",
        )
        .join("");

      const pairResponse = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddresses}`,
      );

      if (!pairResponse.ok) {
        console.error(pairResponse);
        throw new Error(
          `Failed to fetch pair data: ${pairResponse.statusText}`,
        );
      }

      const pairData = await pairResponse.json();

      return {
        trending: profileData.map((token: { tokenAddress: string }) => {
          const pairInfo = pairData.pairs?.find(
            (pair: { baseToken: { address: string } }) =>
              pair.baseToken.address.toLowerCase() ===
              token.tokenAddress.toLowerCase(),
          );

          return {
            tokenAddress: token?.tokenAddress,
            description: token?.description,
            priceUSD: pairInfo?.priceUsd || "0",
            volume24h: pairInfo?.volume?.h24 || "0",
            priceChange24h: pairInfo?.priceChange?.h24 || "0",
          };
        }),
      };
    } catch (error) {
      console.error("Market analysis failed:", error);
      return {
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      };
    }
  },
});

export function dexscreenerTools(): BaseTool[] {
  return createToolCollection([getLatestTokens]);
}
