import { Token } from "zrouter-sdk";
import { ResolvedToken, ZToken } from "./types.js";
import { Address, parseUnits } from "viem";

type TokenListEntry = {
  chainId: number;
  address: string;
  decimals?: number;
  name: string;
  symbol: string;
  logoURI?: string;
  extensions?: {
    standard?: "ERC20" | "ERC6909" | string;
    id?: string;
    [k: string]: unknown;
  };
};

let _tokenListCache: { fetchedAt: number; tokens: TokenListEntry[] } | null = null;

async function loadTokenList(): Promise<TokenListEntry[]> {
  const now = Date.now();
  if (_tokenListCache && now - _tokenListCache.fetchedAt < 5 * 60_000) return _tokenListCache.tokens;

  const res = await fetch("https://assets.zamm.finance/tokenlist.json", {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch tokenlist: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const tokens: TokenListEntry[] = Array.isArray(json?.tokens) ? json.tokens : [];
  _tokenListCache = { fetchedAt: now, tokens };
  return tokens;
}

export async function resolveInputToToken(input: string | ZToken, chainId: number): Promise<ResolvedToken & { symbol?: string }> {
  if (typeof input !== "string") {
    const enriched = await enrichFromListByAddress(input.address, chainId, input.id);
    if (enriched) return enriched;
    return {
      address: input.address,
      id: input.id,
      standard: input.id !== undefined ? "ERC6909" : "ERC20",
      decimals: input.id !== undefined ? 0 : 18,
    };
  }

  const sym = input.trim().toUpperCase();
  const entry = await findTokenListEntryBySymbol(sym, chainId);
  if (!entry) throw new Error(`Symbol "${sym}" not found on chainId ${chainId}.`);

  const standard = entry.extensions?.standard === "ERC6909" ? "ERC6909" : "ERC20";
  const idStr = entry.extensions?.id as string | undefined;
  const id = idStr !== undefined ? BigInt(idStr) : undefined;
  const decimals =
    typeof entry.decimals === "number" ? entry.decimals : standard === "ERC6909" ? 0 : 18;

  return {
    address: entry.address as Address,
    id,
    standard,
    decimals,
    symbol: entry.symbol,
  };
}

async function findTokenListEntryBySymbol(symbol: string, chainId: number): Promise<TokenListEntry | undefined> {
  const list = await loadTokenList();
  const candidates = list.filter(
    (t) => t.chainId === chainId && t.symbol?.toUpperCase() === symbol.toUpperCase()
  );
  candidates.sort((a, b) => {
    const aIs20 = a.extensions?.standard !== "ERC6909";
    const bIs20 = b.extensions?.standard !== "ERC6909";
    return Number(bIs20) - Number(aIs20); // prefer ERC20
  });
  return candidates[0];
}

export async function enrichFromListByAddress(address: Address, chainId: number, id?: bigint): Promise<(ResolvedToken & { symbol?: string }) | null> {
  const list = await loadTokenList();
  const entry = list.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()
  );
  if (!entry) return null;

  const standard = entry.extensions?.standard === "ERC6909" || id !== undefined ? "ERC6909" : "ERC20";
  const decimals =
    typeof entry.decimals === "number" ? entry.decimals : standard === "ERC6909" ? 0 : 18;
  const entryId = entry.extensions?.id !== undefined ? BigInt(entry.extensions.id as string) : undefined;

  return {
    address,
    id: id ?? entryId,
    standard,
    decimals,
    symbol: entry.symbol,
  };
}

export function toBaseUnits(amountStr: string, token: ResolvedToken): bigint {
  if (!/^\d+(\.\d+)?$/.test(amountStr))
    throw new Error(`Invalid amount "${amountStr}". Use a numeric value.`);

  if (token.standard === "ERC20") {
    return parseUnits(amountStr, token.decimals ?? 18);
  }
  if ((token.decimals ?? 0) > 0) {
    return parseUnits(amountStr, token.decimals);
  }
  if (amountStr.includes(".")) {
    throw new Error(`Amount "${amountStr}" must be an integer for ERC6909 token id ${token.id ?? "(unspecified)"}`);
  }
  return BigInt(amountStr);
}

export function asToken(t: ResolvedToken): Token {
  return t.id !== undefined ? { address: t.address, id: t.id } : { address: t.address };
}
