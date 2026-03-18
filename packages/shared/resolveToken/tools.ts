import { z } from "zod";
import { createTool } from "../client.js";
import { resolveTokenChains, TOKEN_REGISTRY } from "./constants.js";

const resolveTokenParameters = z.object({
  symbol: z.string().describe("Token symbol (e.g. 'USDC', 'DAI', 'WETH')"),
  chainId: z.number().describe("Chain ID to resolve on (1 = Ethereum, 8453 = Base, 42161 = Arbitrum, 10 = Optimism)"),
});

export const resolveTokenTool = createTool({
  name: "resolveToken",
  description:
    "Resolve a token symbol (e.g. 'USDC', 'DAI', 'WETH') to its contract address, decimals, and name on a specific chain. Use this before calling tools like getBalanceOf, intentApprove, or intentTransfer when you only have a symbol.",
  supportedChains: resolveTokenChains,
  parameters: resolveTokenParameters,
  execute: async (_client, args) => {
    const { symbol, chainId } = args;
    const key = symbol.toUpperCase();
    const tokenMap = TOKEN_REGISTRY[key] ?? TOKEN_REGISTRY[symbol];

    if (!tokenMap) {
      throw new Error(
        `Unknown token symbol "${symbol}". Supported symbols: ${Object.keys(TOKEN_REGISTRY).join(", ")}`,
      );
    }

    const entry = tokenMap[chainId];
    if (!entry) {
      const supportedChainIds = Object.keys(tokenMap).map(Number);
      throw new Error(
        `Token ${symbol} is not available on chain ${chainId}. Available on chains: ${supportedChainIds.join(", ")}`,
      );
    }

    return {
      symbol: key,
      chainId,
      address: entry.address,
      decimals: entry.decimals,
      name: entry.name,
    };
  },
});
