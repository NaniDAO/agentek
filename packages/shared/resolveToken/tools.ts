import { z } from "zod";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { createTool } from "../client.js";
import { assertOkResponse } from "../utils/fetch.js";
import {
  resolveTokenChains,
  TOKEN_REGISTRY,
  COINGECKO_PLATFORM_TO_CHAIN,
  CHAIN_TO_COINGECKO_PLATFORM,
} from "./constants.js";

/**
 * Cached CoinGecko coin list with platform addresses.
 * Fetched once per process lifetime (list is ~15k entries, ~6MB).
 */
let coinListCache: Array<{
  id: string;
  symbol: string;
  name: string;
  platforms: Record<string, string>;
}> | null = null;

async function fetchCoinGeckoList() {
  if (coinListCache) return coinListCache;

  const response = await fetch(
    "https://api.coingecko.com/api/v3/coins/list?include_platform=true",
  );
  await assertOkResponse(response, "Failed to fetch CoinGecko coin list");
  coinListCache = (await response.json()) as typeof coinListCache;
  return coinListCache!;
}

/**
 * Look up a token symbol on CoinGecko and return its address on the
 * requested chain.  Prefers exact-match symbols; when multiple coins share
 * a symbol it picks the one that has an address on the requested chain
 * and the highest market-cap ranking (earliest in the list).
 */
async function resolveViaCoinGecko(
  symbol: string,
  chainId: number,
): Promise<{ address: string; id: string; name: string } | null> {
  const list = await fetchCoinGeckoList();
  const normalised = symbol.toLowerCase();
  const platformKey = CHAIN_TO_COINGECKO_PLATFORM[chainId];
  if (!platformKey) return null;

  // Find all coins matching the symbol that have an address on this chain
  const matches = list.filter(
    (c) =>
      c.symbol.toLowerCase() === normalised &&
      c.platforms[platformKey] &&
      c.platforms[platformKey].startsWith("0x"),
  );

  if (matches.length === 0) return null;

  // First match is the most "canonical" (CoinGecko sorts by market cap)
  const best = matches[0];
  return {
    address: best.platforms[platformKey],
    id: best.id,
    name: best.name,
  };
}

const resolveTokenParameters = z.object({
  symbol: z
    .string()
    .describe("Token symbol (e.g. 'USDC', 'DAI', 'WETH', 'PEPE')"),
  chainId: z
    .number()
    .describe(
      "Chain ID to resolve on (1 = Ethereum, 8453 = Base, 42161 = Arbitrum, 10 = Optimism, 137 = Polygon)",
    ),
});

export const resolveTokenTool = createTool({
  name: "resolveToken",
  description:
    "Resolve a token symbol (e.g. 'USDC', 'DAI', 'PEPE') to its contract address, decimals, and name on a specific chain. Checks a curated registry first, then falls back to CoinGecko for any listed token. Use this before calling tools like getBalanceOf, intentApprove, or intentTransfer when you only have a symbol.",
  supportedChains: resolveTokenChains,
  parameters: resolveTokenParameters,
  execute: async (client, args) => {
    const { symbol, chainId } = args;
    const key = symbol.toUpperCase();

    // 1. Try the curated static registry first (instant, no network call)
    const tokenMap = TOKEN_REGISTRY[key] ?? TOKEN_REGISTRY[symbol];
    if (tokenMap) {
      const entry = tokenMap[chainId];
      if (entry) {
        return {
          symbol: key,
          chainId,
          address: entry.address,
          decimals: entry.decimals,
          name: entry.name,
          source: "registry",
        };
      }
    }

    // 2. Fall back to CoinGecko coin list
    const cgResult = await resolveViaCoinGecko(symbol, chainId);
    if (!cgResult) {
      const supportedPlatforms = Object.keys(COINGECKO_PLATFORM_TO_CHAIN).join(
        ", ",
      );
      throw new Error(
        `Could not resolve token "${symbol}" on chain ${chainId}. Not in curated registry and not found on CoinGecko for supported platforms: ${supportedPlatforms}`,
      );
    }

    // 3. Fetch on-chain decimals for the CoinGecko result
    let decimals = 18; // sensible default
    try {
      const publicClient = client.getPublicClient(chainId);
      decimals = await publicClient.readContract({
        address: cgResult.address as Address,
        abi: erc20Abi,
        functionName: "decimals",
      });
    } catch {
      // If decimals() call fails, keep the default
    }

    return {
      symbol: key,
      chainId,
      address: cgResult.address,
      decimals,
      name: cgResult.name,
      coingeckoId: cgResult.id,
      source: "coingecko",
    };
  },
});
