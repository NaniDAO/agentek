import { z } from "zod";
import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { zRouterAbi } from "zrouter-sdk";
import { createTool, type AgentekClient } from "../client.js";
import { byteHex, identityAddress, quantitySchema, uint256 } from "../utils/exact.js";
import { ZQUOTER_ADDRESS, ZROUTER_ADDRESS, buildBestSwap } from "./zquoter.js";
import { fetchApiRoutes } from "./api.js";

const assetSchema = z.object({ address: identityAddress, id: quantitySchema.default("0") }).strict();
export const swapRequestSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.string().min(1).max(128),
  owner: identityAddress, chainId: z.number().int().positive().safe(), recipient: identityAddress,
  sellAsset: assetSchema, buyAsset: assetSchema, mode: z.enum(["EXACT_IN", "EXACT_OUT"]),
  amountRaw: quantitySchema, boundRaw: quantitySchema, deadline: quantitySchema,
  slippageBps: z.number().int().min(0).max(9999).default(50),
  source: z.enum(["zquoter", "zrouter-api", "0x"]).default("zquoter"),
}).strict();
export type SwapRequest = z.infer<typeof swapRequestSchema>;
type Op = { target: string; value: string; data: Hex };
const zero = "0x" + "0".repeat(40);
const layouts = {
  "0x6e0a4f98": { name: "swapV2", words: 7, asset: 2, amount: 4 },
  "0xafeae12b": { name: "swapV3", words: 8, asset: 3, amount: 5 },
  "0x21c0dad2": { name: "swapV4", words: 9, asset: 4, amount: 6 },
  "0x9d5b5af8": { name: "swapVZ", words: 10, asset: 3, amount: 7 },
} as const;

/** Only canonical fixed ABI encodings. Dynamic/multicall routes remain unavailable. */
export function validateSwapCall(request: SwapRequest, op: Op) {
  const r = swapRequestSchema.parse(request), router = ZROUTER_ADDRESS[r.chainId];
  if (!router || op.target.toLowerCase() !== router.toLowerCase()) throw new Error("Unauthenticated execution target");
  const data = byteHex(op.data, 324), layout = layouts[data.slice(0, 10) as keyof typeof layouts];
  if (!layout || data.length !== 10 + layout.words * 64) throw new Error("Unknown or noncanonical swap ABI");
  const words = Array.from({ length: layout.words }, (_, i) => data.slice(10 + i * 64, 74 + i * 64));
  const address = (i: number) => {
    if (!/^0{24}[0-9a-f]{40}$/.test(words[i])) throw new Error("Noncanonical address word");
    return "0x" + words[i].slice(24);
  };
  const n = (i: number) => BigInt("0x" + words[i]);
  if (address(0) !== r.recipient || n(1) !== (r.mode === "EXACT_OUT" ? 1n : 0n)) throw new Error("Recipient or mode mismatch");
  if (address(layout.asset) !== r.sellAsset.address || address(layout.asset + 1) !== r.buyAsset.address) throw new Error("Asset pair mismatch");
  if (layout.name === "swapVZ") {
    if (n(5) !== uint256(r.sellAsset.id) || n(6) !== uint256(r.buyAsset.id)) throw new Error("Token ID mismatch");
    // feeOrHook values above uint24 can encode arbitrary hooks. Their identity is not proved locally.
    if (n(2) > 10000n) throw new Error("Unknown VZ hook or fee semantics");
  } else if (r.sellAsset.id !== "0" || r.buyAsset.id !== "0") throw new Error("ABI does not support token IDs");
  if (layout.name === "swapV3" || layout.name === "swapV4") {
    if (n(2) > 10000n) throw new Error("Unsupported fee tier");
  }
  if (layout.name === "swapV4") {
    const tick = n(3), signed = tick >= (1n << 255n) ? tick - (1n << 256n) : tick;
    if (signed < -(1n << 23n) || signed >= (1n << 23n)) throw new Error("Noncanonical int24");
  }
  if (n(layout.amount) !== uint256(r.amountRaw) || n(layout.amount + 1) !== uint256(r.boundRaw) || n(layout.amount + 2) !== uint256(r.deadline)) throw new Error("Economic commitment mismatch");
  const spend = r.mode === "EXACT_IN" ? r.amountRaw : r.boundRaw;
  const nativeValue = r.sellAsset.address === zero && r.sellAsset.id === "0" ? spend : "0";
  if (uint256(op.value).toString() !== nativeValue) throw new Error("Native value mismatch");
  return { abi: layout.name, nativeValue, maximumInputRaw: spend, target: router.toLowerCase(),
    deploymentIdentity: `local-zrouter:${r.chainId}:${router.toLowerCase()}`, provenance: "packages/shared/zrouter/zquoter.ts" };
}

export function exactSwapOps(request: SwapRequest, swap: Op) {
  const r = swapRequestSchema.parse(request), execution = validateSwapCall(r, swap);
  if (r.sellAsset.id !== "0") throw new Error("ERC6909 allowance semantics unavailable; no operator grant");
  const allowanceRequirements = execution.nativeValue !== "0" ? [] : [{
    token: r.sellAsset.address, spender: execution.target, amountRaw: execution.maximumInputRaw, standard: "ERC20",
  }];
  const ops: Op[] = allowanceRequirements.map(a => ({ target: a.token, value: "0", data: encodeFunctionData({
    abi: erc20Abi, functionName: "approve", args: [a.spender as Address, uint256(a.amountRaw)],
  }) }));
  ops.push({ target: execution.target, value: execution.nativeValue, data: byteHex(swap.data) });
  return { ops, allowanceRequirements, execution };
}

/** Re-check the full batch, including each approval, before delivering or consuming a proposal. */
export function validateSwapOps(request: SwapRequest, ops: Op[]) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 2) throw new Error("Unknown batch");
  const expected = exactSwapOps(request, ops[ops.length - 1]);
  if (expected.ops.length !== ops.length || expected.ops.some((op, i) => op.target !== ops[i].target.toLowerCase() || op.value !== ops[i].value || op.data !== byteHex(ops[i].data))) throw new Error("Allowance or batch mismatch");
  return expected;
}

export function unavailableSwap(request: unknown, reason: string, source = "unknown", status = "unknown") {
  return { schemaVersion: 1, availability: "unavailable", reason, request, source, provenance: source === "0x" ? "execution-proof-unavailable" : "shared-validation", observedAt: new Date().toISOString(), expiresAt: null,
    ops: [], allowanceRequirements: [], validation: { status, evidence: [{ status, reason }] },
    simulation: { status: "unknown", reason: "No simulation observed" }, fees: { status: "unknown", reason: "No fee observation" }, unsigned: true };
}

export function deliverSwap(request: SwapRequest, ops: Op[], observation: { observedAt: string; blockNumber: string; blockHash: string; blockTimestamp: string; amountInRaw: string; amountOutRaw: string }) {
  const r = swapRequestSchema.parse(request), checked = validateSwapOps(r, ops);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (uint256(r.deadline) <= now || uint256(r.deadline) > now + 86400n) throw new Error("Expired or unbounded deadline");
  const blockTime = uint256(observation.blockTimestamp);
  if (blockTime > now + 30n || now - blockTime > 300n) throw new Error("Quote block is stale or has unknown freshness");
  const observed = Date.parse(observation.observedAt);
  if (!Number.isFinite(observed) || observed > Date.now() || Date.now() - observed > 60000) throw new Error("Stale quote observation");
  if (!/^0x[0-9a-f]{64}$/.test(observation.blockHash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(observation.blockNumber)) throw new Error("Missing block identity");
  const input = uint256(observation.amountInRaw), output = uint256(observation.amountOutRaw);
  if (r.mode === "EXACT_IN" ? input !== uint256(r.amountRaw) || output < uint256(r.boundRaw) : output !== uint256(r.amountRaw) || input > uint256(r.boundRaw)) throw new Error("Quote scalar mismatch");
  return { schemaVersion: 1, availability: "available", reason: null, unsigned: true, requestId: r.requestId,
    owner: r.owner, chainId: r.chainId, chain: r.chainId, recipient: r.recipient, deadline: r.deadline, mode: r.mode,
    sellAsset: r.sellAsset, buyAsset: r.buyAsset, amountRaw: r.amountRaw,
    inputRaw: r.mode === "EXACT_IN" ? r.amountRaw : observation.amountInRaw,
    minimumOutputRaw: r.mode === "EXACT_IN" ? r.boundRaw : r.amountRaw,
    maximumInputRaw: checked.execution.maximumInputRaw, nativeValueRaw: checked.execution.nativeValue,
    source: r.source, provenance: checked.execution.provenance, observedAt: observation.observedAt,
    expiresAt: new Date(Math.min(observed + 60000, Number(uint256(r.deadline)) * 1000)).toISOString(),
    quoteBlockBinding: r.source === "zquoter" ? "verified" : "unknown",
    observation, commitment: r, execution: checked.execution, ops: checked.ops, allowanceRequirements: checked.allowanceRequirements, requiresAtomicExecution: checked.ops.length > 1,
    validation: { status: "verified", evidence: [{ status: "verified", reason: "Local target, fixed ABI, exact economics and full batch match" }],
      coverage: "Construction only. Deployment code/proxy upgrades and mined payout are not live-verified; native approval remains required." },
    simulation: { status: "unknown", reason: "No simulation observed" }, fees: { status: "unknown", reason: "No fee observation" } };
}

function apiSingleCall(r: SwapRequest, step: any): Op {
  const names = { V2: "swapV2", V3: "swapV3", V4: "swapV4", VZ: "swapVZ" };
  const name = names[step.kind];
  if (!name) throw new Error("Unsupported API route ABI; 0x target/proxy semantics unavailable locally");
  if (step.side !== r.mode || step.tokenIn.address.toLowerCase() !== r.sellAsset.address || step.tokenOut.address.toLowerCase() !== r.buyAsset.address || (step.tokenIn.id ?? 0n).toString() !== r.sellAsset.id || (step.tokenOut.id ?? 0n).toString() !== r.buyAsset.id || step.amount.toString() !== r.amountRaw || step.limit.toString() !== r.boundRaw) throw new Error("API economics mismatch");
  const router = ZROUTER_ADDRESS[r.chainId];
  if (!router || (step.router && step.router.toLowerCase() !== router.toLowerCase())) throw new Error("API target mismatch");
  if (step.to && step.to.toLowerCase() !== r.recipient) throw new Error("API recipient mismatch");
  if (step.deadline !== undefined && step.deadline !== uint256(r.deadline)) throw new Error("API deadline mismatch");
  const args: any[] = [r.recipient, r.mode === "EXACT_OUT"];
  if (name === "swapV3" || name === "swapV4") args.push(step.fee);
  if (name === "swapV4") args.push(step.tickSpacing);
  if (name === "swapVZ") args.push(step.feeOrHook);
  args.push(r.sellAsset.address, r.buyAsset.address);
  if (name === "swapVZ") args.push(uint256(r.sellAsset.id), uint256(r.buyAsset.id));
  args.push(uint256(r.amountRaw), uint256(r.boundRaw), uint256(r.deadline));
  return { target: router, value: r.sellAsset.address === zero ? (r.mode === "EXACT_IN" ? r.amountRaw : r.boundRaw) : "0",
    data: encodeFunctionData({ abi: zRouterAbi, functionName: name, args } as any) };
}

export async function buildNativeSwapProposal(client: AgentekClient, input: SwapRequest) {
  let r: SwapRequest;
  try { r = swapRequestSchema.parse(input); } catch { return unavailableSwap(input, "Unknown schema or malformed request", "unknown", "failed"); }
  if (r.source === "0x") return unavailableSwap(r, "Authoritative 0x execution target/proxy and calldata commitments unavailable locally; simulation cannot prove mined payout", r.source);
  if (!ZROUTER_ADDRESS[r.chainId] || r.source === "zquoter" && !ZQUOTER_ADDRESS[r.chainId]) return unavailableSwap(r, "No locally configured deployment for this route/chain", r.source);
  try {
    if ((await client.getAddress()).toLowerCase() !== r.owner || r.owner === zero) throw new Error("Captured account mismatch");
    if (!uint256(r.amountRaw) || !uint256(r.boundRaw)) throw new Error("Zero economic amount");
    const rpc = client.getPublicClient(r.chainId);
    const startedAt = Date.now();
    if (rpc.chain?.id !== r.chainId || await rpc.getChainId() !== r.chainId) throw new Error("RPC chain mismatch");
    const block = await rpc.getBlock(), observedAt = new Date().toISOString();
    if (typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > BigInt(Math.floor(Date.now() / 1000)) + 30n || BigInt(Math.floor(Date.now() / 1000)) - block.timestamp > 300n) throw new Error("Quote block is stale or has unknown freshness");
    if (typeof block.number !== "bigint" || !block.hash) throw new Error("Missing block identity");
    let swap: Op, amountIn: bigint, amountOut: bigint;
    if (r.source === "zquoter") {
      if (r.sellAsset.id !== "0" || r.buyAsset.id !== "0") throw new Error("zQuoter request ABI cannot capture token IDs");
      const built = await buildBestSwap(rpc, { chainId: r.chainId, blockNumber: block.number, to: r.recipient as Address, exactOut: r.mode === "EXACT_OUT", tokenIn: r.sellAsset.address as Address, tokenOut: r.buyAsset.address as Address, swapAmount: uint256(r.amountRaw), slippageBps: r.slippageBps, deadline: uint256(r.deadline) });
      if (!built) throw new Error("Quoter read failed, partial or malformed");
      if (built.amountLimit.toString() !== r.boundRaw) throw new Error("Captured bound differs from executable quote");
      amountIn = built.amountIn; amountOut = built.amountOut;
      swap = { target: ZROUTER_ADDRESS[r.chainId], value: built.msgValue.toString(), data: built.callData };
    } else {
      const routes = await fetchApiRoutes({ chainId: r.chainId, owner: r.owner, tokenIn: { address: r.sellAsset.address, id: uint256(r.sellAsset.id) }, tokenOut: { address: r.buyAsset.address, id: uint256(r.buyAsset.id) }, side: r.mode, amount: uint256(r.amountRaw), slippageBps: r.slippageBps });
      if (!routes?.length) throw new Error("Quote provider failed, partial, timed out or returned no route");
      const route = routes[0];
      if (route.steps.length !== 1) throw new Error("Multi-hop and batches lack a complete locally verified commitment; unavailable");
      swap = apiSingleCall(r, route.steps[0]);
      amountIn = r.mode === "EXACT_IN" ? uint256(r.amountRaw) : route.expectedAmount;
      amountOut = r.mode === "EXACT_IN" ? route.expectedAmount : uint256(r.amountRaw);
    }
    const checked = exactSwapOps(r, swap);
    const endBlock = await rpc.getBlock({ blockNumber: block.number });
    if (endBlock.hash !== block.hash) throw new Error("Block identity changed while quoting");
    if (Date.now() - startedAt > 60000) throw new Error("Quote expired while loading");
    return deliverSwap(r, checked.ops, { observedAt, blockNumber: `0x${block.number.toString(16)}`, blockHash: block.hash.toLowerCase(), blockTimestamp: block.timestamp.toString(), amountInRaw: amountIn.toString(), amountOutRaw: amountOut.toString() });
  } catch (err) { return unavailableSwap(r, err instanceof Error ? err.message : "Failed quote validation", r.source, "failed"); }
}

export const getNativeSwapProposal = createTool({ name: "getNativeSwapProposal", description: "Return a versioned unsigned swap proposal bound to a captured raw request. Unproved targets, ABI or economics fail closed. Native host owns review, signing, simulation and journals.",
  parameters: swapRequestSchema, execute: buildNativeSwapProposal });
