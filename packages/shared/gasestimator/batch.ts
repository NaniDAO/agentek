import { z } from "zod";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { createTool } from "../client.js";

const implementation = "0xd54cb65224410f3ff97a8e72f363f224419f4fb0" as Address;
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const quantity = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);
const bytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(131074);
const abi = parseAbi([
  "function batch(address[],uint256[],bytes[])",
  "function init(address[],uint32,uint256,address)",
]);
const hex = (value: bigint) => `0x${value.toString(16)}`;
const uint = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error("Invalid RPC quantity");
  return BigInt(value);
};

/** Public RPC reads and unsigned construction only. No wallet client or signer. */
export const quoteNaniBatchTool = createTool({
  name: "quoteNaniBatch",
  description: "Prepare an unsigned Nani atomic batch and exact EIP-1559 execution fee cap. Includes delegation/init when needed. Missing RPC evidence fails closed; extra rollup fees remain explicitly unknown. Human review and native signing required.",
  parameters: z.object({
    owner: address, chainId: z.number().int().positive(),
    calls: z.array(z.object({ to: address, value: quantity, data: bytes }).strict()).min(1).max(32),
  }).strict(),
  execute: async (client, args) => {
    if (![1, 8453, 42161, 10, 4663, 11155111, 84532].includes(args.chainId)) throw new Error("Unsupported batch network");
    const rpc = client.getPublicClient(args.chainId);
    // Raw RPC is intentional: state overrides must apply to the whole batch,
    // including state dependencies such as approve then swap.
    const request = (method: string, params: unknown[]) => (rpc.request as any)({ method, params });
    if (uint(await request("eth_chainId", [])) !== BigInt(args.chainId)) throw new Error("RPC network mismatch");
    const startedAt = Math.floor(Date.now() / 1000);
    const owner = args.owner.toLowerCase() as Address;
    const code = await request("eth_getCode", [owner, "latest"]);
    const addsDelegation = code === "0x" || code === "0x0";
    if (!addsDelegation && String(code).toLowerCase() !== `0xef0100${implementation.slice(2)}`) throw new Error("Unknown account delegation");
    const calls = args.calls.map(call => ({ ...call }));
    let overrides: Record<string, { code: Hex }> | undefined;
    let initializesAccount = false;
    if (addsDelegation) {
      const runtime = await request("eth_getCode", [implementation, "latest"]);
      if (typeof runtime !== "string" || !/^0x(?:[0-9a-fA-F]{2}){2,}$/.test(runtime)) throw new Error("Implementation unavailable");
      overrides = { [owner]: { code: runtime as Hex } };
      const threshold = uint(await request("eth_call", [{ from: owner, to: owner, data: "0x42cde4e8" }, "latest", overrides]));
      initializesAccount = threshold === 0n;
      if (initializesAccount) calls.unshift({ to: owner, value: "0x0", data: encodeFunctionData({
        abi, functionName: "init", args: [[owner], 0, 1n, "0x0000000000000000000000000000000000000000"],
      }) });
    }
    const data = encodeFunctionData({ abi, functionName: "batch", args: [
      calls.map(call => call.to as Address), calls.map(call => BigInt(call.value)), calls.map(call => call.data as Hex),
    ] });
    const transaction = { from: owner, to: owner, value: "0x0", data };
    const params: unknown[] = [transaction, "latest"];
    if (overrides) params.push(overrides);
    const [rawGas, block, tipRaw, balanceRaw] = await Promise.all([
      request("eth_estimateGas", params), request("eth_getBlockByNumber", ["latest", false]),
      request("eth_maxPriorityFeePerGas", []), request("eth_getBalance", [owner, "pending"]),
    ]);
    const estimated = uint(rawGas);
    if (estimated === 0n) throw new Error("Empty batch gas estimate");
    // Estimating under a code override omits authorization processing. Reserve
    // its full 25k cost, then buffer the entire execution estimate by 25%.
    const gas = ((estimated + (addsDelegation ? 25000n : 0n)) * 125n + 99n) / 100n;
    const tip = uint(tipRaw), base = uint(block?.baseFeePerGas), price = base * 2n + tip;
    if (gas > 12000000n || price === 0n || price > 2000000000000n) throw new Error("Batch fee exceeds supported limits");
    const totalValue = args.calls.reduce((sum, call) => sum + BigInt(call.value), 0n);
    const maximumFee = gas * price;
    if (totalValue + maximumFee >= 1n << 256n) throw new Error("Batch value overflow");
    const balance = uint(balanceRaw);
    if (Math.floor(Date.now() / 1000) >= startedAt + 120) throw new Error("Batch quote expired while loading");
    return { schemaVersion: 1, owner, chainId: args.chainId, data, addsDelegation, initializesAccount,
      gasLimit: hex(gas), maxFeePerGas: hex(price), maxPriorityFeePerGas: hex(tip),
      maximumFee: hex(maximumFee), totalValue: hex(totalValue), balance: hex(balance),
      observedAt: startedAt, expiresAt: startedAt + 120,
      // Do not pretend execution gas bounds separate L1/operator charges.
      additionalFeeKnown: args.chainId === 1 || args.chainId === 11155111,
    };
  },
});
