import { Token } from "zrouter-sdk";
import { ResolvedToken, ZToken } from "./types.js";
import { Address, erc20Abi } from "viem";
import { parseExactUnits, precision, uint256 } from "../utils/exact.js";
import { TOKEN_REGISTRY } from "../resolveToken/constants.js";
import { assertOkResponse, readBoundedJSON } from "../utils/fetch.js";

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
  const json: any = await readBoundedJSON(res, 8 * 1024 * 1024);
  if (!Array.isArray(json?.tokens) || json.tokens.length > 20000) throw new Error("Malformed or oversized token list");
  const tokens: TokenListEntry[] = json.tokens;
  _tokenListCache = { fetchedAt: now, tokens };
  return tokens;
}

/**
 * `publicClient` is optional only so existing callers keep compiling; pass it
 * wherever one is available. Without it an unlisted token can't have its
 * decimals read, and construction must remain unavailable.
 */
export async function resolveInputToToken(input: string | ZToken, chainId: number, publicClient?: { readContract: (args: any) => Promise<any> }): Promise<ResolvedToken & { symbol?: string }> {
  const native = "0x0000000000000000000000000000000000000000";
  const text = typeof input === "string" ? input.trim() : input.address;
  let address = text as Address, id = typeof input === "string" ? undefined : input.id, symbol: string | undefined;
  let pinned: number | undefined;
  if (text.toUpperCase() === "ETH") address = native;
  else if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    const registry = TOKEN_REGISTRY[text.toUpperCase()]?.[chainId];
    const entry = registry ?? await findTokenListEntryBySymbol(text.toUpperCase(), chainId);
    if (!entry || !/^0x[0-9a-fA-F]{40}$/.test(entry.address)) throw new Error("Token identity unavailable");
    address = entry.address as Address; symbol = text.toUpperCase(); pinned = registry?.decimals;
    if (!registry && 'extensions' in entry && entry.extensions?.id !== undefined) id = uint256(entry.extensions.id as string);
  }
  if (address.toLowerCase() === native && (id === undefined || id === 0n)) return { address, id, standard: "ERC20", decimals: 18, precisionSource: "native-chain-unit", symbol: "ETH" };
  if (id !== undefined && id !== 0n) throw new Error("ERC6909 precision unavailable; indexed precision cannot authorize construction");
  const trusted = Object.values(TOKEN_REGISTRY).map(m => m[chainId]).find(t => t?.address.toLowerCase() === address.toLowerCase());
  pinned ??= trusted?.decimals;
  if (!publicClient) throw new Error("Contract-verified precision unavailable");
  const decimals = precision(await publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }));
  if (pinned !== undefined && decimals !== pinned) throw new Error("Contract precision conflicts with pinned metadata");
  return { address, id, standard: "ERC20", decimals, precisionSource: "contract", symbol };
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

export async function enrichFromListByAddress(address: Address, chainId: number, id?: bigint): Promise<({ address: Address; id?: bigint; standard: "ERC20" | "ERC6909"; decimals: number | null; symbol?: string; precisionSource: "indexed-display"; authorizesConstruction: false }) | null> {
  const list = await loadTokenList();
  const entry = list.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()
  );
  if (!entry) return null;

  const standard = entry.extensions?.standard === "ERC6909" || id !== undefined ? "ERC6909" : "ERC20";
  const decimals =
    typeof entry.decimals === "number" && Number.isInteger(entry.decimals) && entry.decimals >= 0 && entry.decimals <= 255 ? entry.decimals : null;
  const entryId = entry.extensions?.id !== undefined ? uint256(entry.extensions.id as string) : undefined;

  return {
    address,
    id: id ?? entryId,
    standard,
    decimals,
    symbol: entry.symbol,
    precisionSource: "indexed-display", authorizesConstruction: false,
  };
}

export function toBaseUnits(amountStr: string, token: ResolvedToken): bigint {
  if (!["contract", "native-chain-unit"].includes(token.precisionSource)) throw new Error("Display precision cannot authorize construction");
  if (token.decimals === undefined || token.decimals === null) throw new Error("Unknown precision");
  return parseExactUnits(amountStr, token.decimals);
}

export function asToken(t: ResolvedToken): Token {
  return t.id !== undefined ? { address: t.address, id: t.id } : { address: t.address };
}
