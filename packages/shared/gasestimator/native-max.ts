import { z } from "zod";
import { keccak256, stringToHex } from "viem";
import { createTool } from "../client.js";
import { bufferedGas, feeCap, quoteNaniBatchTool, uint } from "./batch.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(131074);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const nativeMaxInput = z.object({
  owner: address,
  chainId: z.number().int().positive().safe(),
  recipient: address,
  calldata: bytes,
  executionMode: z.enum(["direct", "nani-batch"]),
  purpose: z.enum(["transfer", "swap", "bridge"]),
}).strict();
const identity = nativeMaxInput.extend({ accountCode: bytes.nullable(), nonce: decimal.nullable(), blockNumber: decimal.nullable(), blockHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable() });
const transaction = z.object({ from: address, to: address, value: decimal, data: bytes,
  nonce: decimal, chainId: z.number().int().positive().safe(), gasLimit: decimal,
  maxFeePerGas: decimal, maxPriorityFeePerGas: decimal }).strict();
const fees = z.object({ gasLimit: decimal, maxFeePerGas: decimal, maxPriorityFeePerGas: decimal,
  executionFeeCap: decimal, additionalFeeCap: decimal.nullable(), totalFeeCap: decimal.nullable(),
  gasBufferPercent: z.literal(25), authorizationGas: decimal,
  additionalFeeStatus: z.enum(["not-applicable", "unknown"]) }).strict();
export const nativeMaxOutput = z.object({
  schemaVersion: z.literal(1), availability: z.enum(["available", "unavailable"]),
  reason: z.enum(["READY", "ZERO_SPENDABLE", "INVALID_INPUT", "UNSUPPORTED_NETWORK", "ROUTE_REQUIRES_QUOTE",
    "ADDITIONAL_FEE_UNKNOWN", "ACCOUNT_MODE_MISMATCH", "IDENTITY_CHANGED", "INSUFFICIENT_BALANCE",
    "ESTIMATE_UNAVAILABLE", "ESTIMATE_NOT_CONVERGED", "EXPIRED"]),
  identity, transactionId: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
  balance: decimal.nullable(), spendable: decimal.nullable(), fees: fees.nullable(),
  transaction: transaction.nullable(), addsDelegation: z.boolean().nullable(), initializesAccount: z.boolean().nullable(),
  observedAt: z.number().int(), expiresAt: z.number().int(),
}).strict();

/** No signer, wallet, approval or submission API is accessed. All quantities are bigint. */
export const quoteNaniNativeMaxTool = createTool({
  name: "quoteNaniNativeMax",
  description: "Estimate exact native transfer Max with a buffered EIP-1559 fee reserve and unsigned transaction identity. Direct EOA or Nani batch execution only. Swap/bridge and unknown rollup fees fail closed. Native host must independently validate and approve; never signs or submits.",
  parameters: nativeMaxInput,
  execute: async (client, input) => {
    // AgentekClient validates inputs; validate again for direct tool callers.
    const args = nativeMaxInput.parse(input);
    const started = Math.floor(Date.now() / 1000);
    const owner = args.owner.toLowerCase(), recipient = args.recipient.toLowerCase();
    const result: z.infer<typeof nativeMaxOutput> = {
      schemaVersion: 1, availability: "unavailable", reason: "ESTIMATE_UNAVAILABLE",
      identity: { ...args, owner, recipient, calldata: args.calldata.toLowerCase(), accountCode: null, nonce: null, blockNumber: null, blockHash: null },
      transactionId: null, balance: null, spendable: null, fees: null, transaction: null,
      addsDelegation: null, initializesAccount: null, observedAt: started, expiresAt: started + 120,
    };
    const unavailable = (reason: typeof result.reason) => nativeMaxOutput.parse({ ...result, reason });
    if (args.purpose !== "transfer") return unavailable("ROUTE_REQUIRES_QUOTE");
    // Transfer Max is deliberately not an arbitrary contract/route Max API.
    if (args.calldata !== "0x" || owner === recipient || /^0x0{40}$/.test(recipient)) return unavailable("INVALID_INPUT");
    if (![1, 11155111, 8453, 84532, 10, 42161, 4663].includes(args.chainId)) return unavailable("UNSUPPORTED_NETWORK");
    if (![1, 11155111].includes(args.chainId)) return unavailable("ADDITIONAL_FEE_UNKNOWN");
    try {
      const rpc = client.getPublicClient(args.chainId);
      const request = (method: string, params: unknown[]) => (rpc.request as any)({ method, params });
      const snapshot = async () => {
        const [chain, block, code, nonce, balance] = await Promise.all([
          request("eth_chainId", []), request("eth_getBlockByNumber", ["latest", false]), request("eth_getCode", [owner, "latest"]),
          request("eth_getTransactionCount", [owner, "pending"]), request("eth_getBalance", [owner, "pending"]),
        ]);
        if (uint(chain) !== BigInt(args.chainId)) throw new Error("identity");
        if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw new Error("code");
        if (typeof block?.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) throw new Error("block");
        return { blockNumber: uint(block.number).toString(), blockHash: block.hash.toLowerCase(), baseFee: uint(block.baseFeePerGas).toString(), accountCode: code.toLowerCase(), nonce: uint(nonce).toString(), balance: uint(balance).toString() };
      };
      const before = await snapshot();
      Object.assign(result.identity, { blockNumber: before.blockNumber, blockHash: before.blockHash, accountCode: before.accountCode, nonce: before.nonce });
      result.balance = before.balance;
      if (args.executionMode === "direct" && before.accountCode !== "0x") return unavailable("ACCOUNT_MODE_MISMATCH");
      const balance = BigInt(before.balance);
      let candidate = 0n;
      // Gas may depend on transferred value and batch calldata. Re-estimate the
      // exact candidate until both amount and reserve converge. Never use the
      // initial zero-value estimate as evidence for a different transaction.
      for (let attempt = 0; attempt < 8; attempt++) {
        let gas: bigint, price: bigint, tip: bigint, data = "0x", to = recipient;
        if (args.executionMode === "nani-batch") {
          const quote = await quoteNaniBatchTool.execute(client, {
            owner, chainId: args.chainId, calls: [{ to: recipient, value: `0x${candidate.toString(16)}`, data: args.calldata }],
          });
          if (quote.owner !== owner || quote.chainId !== args.chainId || uint(quote.balance) !== balance)
            return unavailable("IDENTITY_CHANGED");
          if (!quote.additionalFeeKnown) return unavailable("ADDITIONAL_FEE_UNKNOWN");
          gas = uint(quote.gasLimit); price = uint(quote.maxFeePerGas); tip = uint(quote.maxPriorityFeePerGas);
          data = quote.data; to = owner;
          result.addsDelegation = quote.addsDelegation; result.initializesAccount = quote.initializesAccount;
        } else {
          const [rawGas, rawTip] = await Promise.all([
            request("eth_estimateGas", [{ from: owner, to: recipient, value: `0x${candidate.toString(16)}`, data: args.calldata, nonce: `0x${BigInt(before.nonce).toString(16)}` }, "pending"]),
            request("eth_maxPriorityFeePerGas", []),
          ]);
          const estimated = uint(rawGas);
          if (estimated === 0n) throw new Error("empty estimate");
          gas = bufferedGas(estimated); tip = uint(rawTip); price = feeCap(gas, BigInt(before.baseFee), tip);
          result.addsDelegation = false; result.initializesAccount = false;
        }
        const reserve = gas * price;
        result.fees = { gasLimit: gas.toString(), maxFeePerGas: price.toString(), maxPriorityFeePerGas: tip.toString(),
          executionFeeCap: reserve.toString(), additionalFeeCap: "0", totalFeeCap: reserve.toString(),
          gasBufferPercent: 25, authorizationGas: result.addsDelegation ? "25000" : "0", additionalFeeStatus: "not-applicable" };
        if (reserve > balance) return unavailable("INSUFFICIENT_BALANCE");
        const next = balance - reserve;
        if (next !== candidate) { candidate = next; continue; }
        const after = await snapshot();
        if (JSON.stringify(before) !== JSON.stringify(after)) return unavailable("IDENTITY_CHANGED");
        if (Math.floor(Date.now() / 1000) >= result.expiresAt) return unavailable("EXPIRED");
        result.transaction = { from: owner, to, data, value: args.executionMode === "direct" ? candidate.toString() : "0",
          nonce: before.nonce, chainId: args.chainId, gasLimit: gas.toString(), maxFeePerGas: price.toString(), maxPriorityFeePerGas: tip.toString() };
        result.spendable = candidate.toString(); result.availability = "available";
        result.reason = candidate === 0n ? "ZERO_SPENDABLE" : "READY";
        // A local identity digest, never a mined transaction hash.
        result.transactionId = keccak256(stringToHex(JSON.stringify([
          1, [owner, args.chainId, recipient, args.calldata, args.executionMode, args.purpose,
            before.accountCode, before.nonce, before.blockNumber, before.blockHash],
          [owner, to, result.transaction.value, data, before.nonce, args.chainId,
            gas.toString(), price.toString(), tip.toString()],
          result.addsDelegation, result.initializesAccount,
        ])));
        return nativeMaxOutput.parse(result);
      }
      return unavailable("ESTIMATE_NOT_CONVERGED");
    } catch (error) {
      return unavailable(error instanceof Error && error.message === "identity" ? "IDENTITY_CHANGED"
        : error instanceof Error && error.message === "Unknown account delegation" ? "ACCOUNT_MODE_MISMATCH" : "ESTIMATE_UNAVAILABLE");
    }
  },
});
