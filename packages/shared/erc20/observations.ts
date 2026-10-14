import { z } from "zod";
import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { createTool, type AgentekClient } from "../client.js";
import { abiWord, identityAddress, precision } from "../utils/exact.js";
import { TOKEN_REGISTRY } from "../resolveToken/constants.js";

export async function observeAsset(client: AgentekClient, args: { owner: string; token: string; chainId: number }) {
  const owner = identityAddress.parse(args.owner), token = identityAddress.parse(args.token);
  const base = { schemaVersion: 1, owner, token, chainId: args.chainId, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(), provenance: "configured-rpc", blockNumber: null, blockHash: null };
  const failure = (reason: string) => ({ ...base, status: "failure", precision: { status: "unknown", decimals: null, reason }, balance: { status: "unknown", raw: null, reason } });
  try {
    const rpc = client.getPublicClient(args.chainId);
    if (rpc.chain?.id !== args.chainId || await rpc.getChainId() !== args.chainId) return failure("RPC chain mismatch");
    const block = await rpc.getBlock();
    if (typeof block.number !== "bigint" || !block.hash) return failure("Missing block identity");
    const pinned = Object.values(TOKEN_REGISTRY).map(m => m[args.chainId]).find(t => t?.address.toLowerCase() === token);
    const native = token === "0x" + "0".repeat(40);
    const read = async (fn: "decimals" | "balanceOf") => {
      if (native) return fn === "decimals" ? 18n : await rpc.getBalance({ address: owner as Address, blockNumber: block.number });
      const result = await rpc.call({ to: token as Address, blockNumber: block.number, data: encodeFunctionData({ abi: erc20Abi, functionName: fn, args: fn === "balanceOf" ? [owner as Address] : [] } as any) });
      return abiWord(result.data);
    };
    const [decimals, balance] = await Promise.allSettled([read("decimals"), read("balanceOf")]);
    const decimalEvidence = decimals.status === "fulfilled" && decimals.value <= 255n
      ? { status: pinned && pinned.decimals !== Number(decimals.value) ? "conflict" : "verified", decimals: precision(Number(decimals.value)), pinnedDecimals: pinned?.decimals ?? null, source: native ? "native-chain-unit" : "contract" }
      : { status: "unknown", decimals: null, pinnedDecimals: pinned?.decimals ?? null, source: "contract", reason: "Precision read failed or malformed" };
    const balanceEvidence = balance.status === "fulfilled" && typeof balance.value === "bigint" && balance.value >= 0n && balance.value < (1n << 256n)
      ? { status: "verified", raw: balance.value.toString() }
      : { status: "failure", raw: null, reason: "Balance unreadable; not zero" };
    const now = BigInt(Math.floor(Date.now() / 1000));
    const freshness = typeof block.timestamp !== "bigint" || block.timestamp > now + 30n ? "unknown" : now - block.timestamp > 300n ? "stale" : "fresh";
    const end = await rpc.getBlock({ blockNumber: block.number });
    if (end.hash !== block.hash) return failure("Block changed while reading");
    return { ...base, blockNumber: `0x${block.number.toString(16)}`, blockHash: block.hash.toLowerCase(),
      freshness, expiresAt: freshness === "unknown" ? null : new Date(Math.min(Date.parse(base.expiresAt), Number(block.timestamp + 300n) * 1000)).toISOString(), blockTimestamp: typeof block.timestamp === "bigint" ? block.timestamp.toString() : null,
      status: freshness === "stale" ? "stale" : freshness === "unknown" ? "partial" : decimalEvidence.status === "verified" && balanceEvidence.status === "verified" ? "verified" : "partial", precision: decimalEvidence, balance: balanceEvidence,
      displayMetadata: { source: pinned ? "pinned-local" : "unknown", name: pinned?.name ?? null, decimals: pinned?.decimals ?? null, authorizesConstruction: false },
      coverage: "One asset at one block; unknown or conflicting precision cannot authorize construction." };
  } catch { return failure("RPC observation failed"); }
}
export const observeWalletAsset = createTool({ name: "observeWalletAsset", description: "Read exact balance and contract precision with owner, chain and block evidence. Failed precision remains unknown; display metadata never authorizes construction.",
  parameters: z.object({ owner: identityAddress, token: identityAddress, chainId: z.number().int().positive().safe() }).strict(), execute: observeAsset });
