import { base, mainnet } from "viem/chains";
import { AgentekClient, createTool } from "../client.js";
import z from "zod";

const getLatestTokensParameters = z.object({
  chainId: z.number().describe("Chain ID to fetch trending tokens for (1 for Ethereum, 8453 for Base)"),
});

// This helper maps numeric chain IDs to the corresponding Dexscreener chain identifier.
// Modify the mappings below as needed.
const resolveChainId = (chainId: number) => {
  switch (chainId) {
    case 1:
      return "ethereum";
    case 8453: // example: Base chain id (update as needed)
      return "base";
    // Add more mappings for other chains as required.
    default:
      return "ethereum";
  }
};

export const getLatestTokens = createTool({
  name: "getLatestTokens",
  description: "Get trending tokens from Dexscreener with market data including USD price, 24h volume, and 24h price change. Filters by the specified chain.",
  parameters: getLatestTokensParameters,
  supportedChains: [mainnet, base],
  execute: async (
    _client: AgentekClient,
    args: z.infer<typeof getLatestTokensParameters>,
  ) => {
    // Resolve the Dexscreener chain identifier from the provided chainId.
    const dexChain = resolveChainId(args.chainId);

    // Fetch token profiles from Dexscreener.
    const profileResponse = await fetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (!profileResponse.ok) {
      throw new Error(
        `Failed to fetch token profiles: ${profileResponse.statusText}`,
      );
    }
    let profileData = await profileResponse.json();

    // Filter the token profiles by the resolved chain identifier.
    profileData = profileData.filter(
      (token: { chainId: string }) =>
        token.chainId.toLowerCase() === dexChain.toLowerCase(),
    );

    // Build a comma-separated list of token addresses.
    const tokenAddresses = profileData
      .map((token: { tokenAddress: string }) => token.tokenAddress)
      .join(",");

    // Build the pair data endpoint URL using the resolved chain.
    const pairUrl = `https://api.dexscreener.com/tokens/v1/${dexChain}/${tokenAddresses}`;
    const pairResponse = await fetch(pairUrl);
    if (!pairResponse.ok) {
      console.error(pairResponse);
      throw new Error(`Failed to fetch pair data: ${pairResponse.statusText}`);
    }
    const pairData = await pairResponse.json();

    // Map the token profiles and enrich them with their corresponding pair information.
    return {
      trending: profileData.map(
        (token: { tokenAddress: string; description?: string }) => {
          const pairInfo = pairData.pairs?.find(
            (pair: { baseToken: { address: string } }) =>
              pair.baseToken.address.toLowerCase() ===
              token.tokenAddress.toLowerCase(),
          );

          return {
            tokenAddress: token.tokenAddress,
            description: token.description,
            priceUSD: pairInfo?.priceUsd || "0",
            volume24h: pairInfo?.volume?.h24 || "0",
            priceChange24h: pairInfo?.priceChange?.h24 || "0",
          };
        },
      ),
    };
  },
});
