import type { Hex } from "viem";

const MAX_BLOCK_AGE_SECONDS = 300n;
const MAX_FUTURE_SKEW_SECONDS = 60n;
type ObservationRpc = {
  getChainId(): Promise<number>;
  getBlock(args: { blockTag: "latest" } | { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
};
export interface ChainObservation {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
}

function checkedHeader(header: Awaited<ReturnType<ObservationRpc["getBlock"]>>, expectedNumber?: bigint) {
  if (!header || typeof header.number !== "bigint" || header.number < 0n || (expectedNumber !== undefined && header.number !== expectedNumber)
    || typeof header.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(header.hash) || /^0x0{64}$/i.test(header.hash)
    || typeof header.timestamp !== "bigint" || header.timestamp < 0n) throw new Error("Observation block identity is unavailable or malformed");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (header.timestamp > now + MAX_FUTURE_SKEW_SECONDS || now - header.timestamp > MAX_BLOCK_AGE_SECONDS) throw new Error("Observation block is stale or has an implausible future timestamp");
  return { blockNumber: header.number, blockHash: header.hash.toLowerCase() as Hex, blockTimestamp: header.timestamp };
}

/** RPC-reported chain and canonical header checks; these do not authenticate the RPC provider. */
export async function beginChainObservation(rpc: ObservationRpc, chainId: number): Promise<ChainObservation> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || await rpc.getChainId() !== chainId) throw new Error("Observation RPC chain does not match the requested chain");
  return { chainId, ...checkedHeader(await rpc.getBlock({ blockTag: "latest" })) };
}

/** Reread by height to detect a canonical-block replacement during the pinned reads. */
export async function finishChainObservation(rpc: ObservationRpc, snapshot: ChainObservation): Promise<void> {
  if (await rpc.getChainId() !== snapshot.chainId) throw new Error("Observation RPC chain changed during the read");
  const current = checkedHeader(await rpc.getBlock({ blockNumber: snapshot.blockNumber }), snapshot.blockNumber);
  if (current.blockHash !== snapshot.blockHash || current.blockTimestamp !== snapshot.blockTimestamp) throw new Error("Observation block changed; retry the complete observation");
}

export function observationIdentity(snapshot: ChainObservation) {
  return { chainId: snapshot.chainId, block: `0x${snapshot.blockNumber.toString(16)}`, blockHash: snapshot.blockHash, blockTimestamp: snapshot.blockTimestamp.toString() };
}
