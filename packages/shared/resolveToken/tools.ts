import { z } from "zod";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { precision } from "../utils/exact.js";
import { createTool } from "../client.js";
import { providerJSON } from "../utils/fetch.js";
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

  const list = await providerJSON(
    "https://api.coingecko.com/api/v3/coins/list?include_platform=true", {},
    "Failed to fetch CoinGecko coin list", {maximumBytes: 16 * 1024 * 1024},
  );
  const parsed = z.array(z.object({
    id: z.string().max(160), symbol: z.string().max(160), name: z.string().max(512),
    platforms: z.record(z.string().max(256)),
  })).max(100_000).safeParse(list);
  if (!parsed.success) throw new Error("Malformed CoinGecko coin list");
  coinListCache = parsed.data as typeof coinListCache;
  return coinListCache!;
}

/** Return all distinct matching contracts; provider ordering confers no identity. */
async function resolveViaCoinGecko(symbol: string, chainId: number, coingeckoId?: string) {
  const list = await fetchCoinGeckoList();
  const platformKey = CHAIN_TO_COINGECKO_PLATFORM[chainId];
  if (!platformKey) return [];
  const matches = list.filter(c => c.symbol.toLowerCase() === symbol.toLowerCase()
    && (!coingeckoId || c.id === coingeckoId)
    && /^0x[0-9a-fA-F]{40}$/.test(c.platforms?.[platformKey] ?? ""));
  const unique = new Map(matches.map(c => [c.platforms[platformKey].toLowerCase(), { address: c.platforms[platformKey], id: c.id, name: c.name }]));
  return [...unique.values()].sort((a,b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
}

const resolveTokenParameters = z.object({
  coingeckoId: z.string().min(1).max(160).optional().describe("Exact provider ID selected by the user from ambiguous candidates; never guess it."),
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
    "Resolve a token symbol (e.g. 'USDC', 'DAI', 'PEPE') to its contract address, decimals, and name on a specific chain. Checks a curated registry first, then returns CoinGecko candidates. An ambiguous symbol requires the user to choose the exact contract or provider ID; never choose the first listing. A result never authorizes construction.",
  supportedChains: resolveTokenChains,
  parameters: resolveTokenParameters,
  execute: async (client, args) => {
    const { symbol, chainId, coingeckoId } = args;
    const key = symbol.toUpperCase();

    // 1. Try the curated static registry first (instant, no network call)
    const tokenMap = TOKEN_REGISTRY[key] ?? TOKEN_REGISTRY[symbol];
    if (tokenMap && !coingeckoId) {
      const entry = tokenMap[chainId];
      if (entry) {
        return {
          symbol: key,
          chainId,
          address: entry.address,
          decimals: entry.decimals,
          name: entry.name,
          source: "registry",
          precisionStatus: "pinned-display",
          authorizesConstruction: false,
        };
      }
    }

    // 2. Fall back to CoinGecko coin list
    const matches = await resolveViaCoinGecko(symbol, chainId, coingeckoId);
    if (matches.length > 1) return {
      schemaVersion: 1, status: "ambiguous", symbol: key, chainId, address: null, decimals: null,
      candidates: matches.slice(0, 20).map(c => ({address: c.address, coingeckoId: c.id, name: c.name})),
      totalCandidates: matches.length, truncated: matches.length > 20, authorizesConstruction: false,
      nextStep: "Ask the user to choose the exact contract or provider ID. Do not select the first candidate or propose a transaction from the symbol.",
    };
    const cgResult = matches[0];
    if (!cgResult) {
      const supportedPlatforms = Object.keys(COINGECKO_PLATFORM_TO_CHAIN).join(
        ", ",
      );
      throw new Error(
        `Could not resolve token "${symbol}" on chain ${chainId}. Not in curated registry and not found on CoinGecko for supported platforms: ${supportedPlatforms}`,
      );
    }

    // 3. Fetch on-chain decimals for the CoinGecko result
    let decimals: number | null = null;
    try {
      const publicClient = client.getPublicClient(chainId);
      decimals = precision(await publicClient.readContract({
        address: cgResult.address as Address,
        abi: erc20Abi,
        functionName: "decimals",
      }));
    } catch {
      // Preserve unreadable precision as unknown; never invent a financial scale.
    }

    return {
      symbol: key,
      chainId,
      address: cgResult.address,
      decimals,
      name: cgResult.name,
      coingeckoId: cgResult.id,
      source: "coingecko",
      precisionStatus: decimals === null ? "unknown" : "contract-read",
      authorizesConstruction: false,
    };
  },
});
