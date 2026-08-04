import { Token } from "zrouter-sdk";
import { ResolvedToken, ZToken } from "./types.js";
import { Address, erc20Abi, parseUnits } from "viem";
import { assertOkResponse } from "../utils/fetch.js";

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
  await assertOkResponse(res, "Failed to fetch tokenlist");
  const json = await res.json();
  const tokens: TokenListEntry[] = Array.isArray(json?.tokens) ? json.tokens : [];
  _tokenListCache = { fetchedAt: now, tokens };
  return tokens;
}

/**
 * `publicClient` is optional only so existing callers keep compiling; pass it
 * wherever one is available. Without it an unlisted token can't have its
 * decimals read, and the resolver has to fall back to assuming 18.
 */
export async function resolveInputToToken(
  input: string | ZToken,
  chainId: number,
  publicClient?: { readContract: (args: any) => Promise<any> }
): Promise<ResolvedToken & { symbol?: string }> {
  if (typeof input !== "string") {
    const enriched = await enrichFromListByAddress(input.address, chainId, input.id);
    if (enriched) return enriched;
    // ERC6909 ids carry their own decimals convention (0); only plain ERC20s
    // need the on-chain read.
    const decimals =
      input.id !== undefined ? 0 : await readDecimals(input.address, publicClient);
    return {
      address: input.address,
      id: input.id,
      standard: input.id !== undefined ? "ERC6909" : "ERC20",
      decimals,
    };
  }

  const trimmed = input.trim();

  // A bare contract address is accepted here as well as a symbol.
  //
  // The schema offered a string (documented as a symbol) or an object
  // (documented as ERC6909-only), which left no slot for "this ERC20, by
  // address". A caller holding an address — the more precise identifier, and
  // the one that can't collide the way symbols do — had nowhere to put it, so
  // it went in the string and got uppercased into a symbol lookup:
  //   Symbol "0XAAEE1A97…" not found on chainId 1
  // Treating it as what it plainly is costs one regex and removes a failure
  // that only ever punished the safer input.
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    const address = trimmed as Address;
    const enriched = await enrichFromListByAddress(address, chainId);
    if (enriched) return enriched;
    return {
      address,
      standard: "ERC20",
      decimals: await readDecimals(address, publicClient),
    };
  }

  const sym = trimmed.toUpperCase();
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

/**
 * Decimals for a token that isn't in the token list.
 *
 * `amount` is human-readable, so decimals set the scale of the trade — assuming
 * 18 for a 6-decimal token sizes it 10^12 too large. The address is right
 * there, so ask the contract rather than guess. 18 remains the last resort for
 * a token that answers nothing, which is the same assumption the list-miss path
 * made before, just no longer the first choice.
 */
async function readDecimals(
  address: Address,
  publicClient?: { readContract: (args: any) => Promise<any> }
): Promise<number> {
  if (!publicClient) return 18;
  try {
    const value = await publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 36 ? n : 18;
  } catch {
    return 18;
  }
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
