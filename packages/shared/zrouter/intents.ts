import { z } from "zod";
import { createTool } from "../client.js";
import { AmountSchema, SymbolOrTokenSchema } from "./types.js";
import { addressSchema } from "../utils.js";
import { resolveInputToToken, toBaseUnits } from "./utils.js";
import { zRouterAddress, zQuoterAddress, buildBestSwap } from "./zquoter.js";
import { buildNativeSwapProposal, unavailableSwap } from "./proposal.js";
const swapParameters = z.object({
  chainId: z.number().int().positive().safe().default(1).describe("Chain ID (1 for Mainnet, 8453 for Base). Default: 1"),
  tokenIn: SymbolOrTokenSchema.describe('Input token — either a symbol string (e.g. "USDT", "ETH") or an object { address, id? } for ERC6909 tokens'),
  tokenOut: SymbolOrTokenSchema.describe('Output token — either a symbol string (e.g. "IZO", "WETH") or an object { address, id? } for ERC6909 tokens'),
  amount: AmountSchema.describe("Amount in human-readable units (e.g. 1.5 or '1.5'). Refers to tokenIn for EXACT_IN, tokenOut for EXACT_OUT."),
  side: z.enum(["EXACT_IN", "EXACT_OUT"]).describe("EXACT_IN: specify the input amount and get the best output. EXACT_OUT: specify the desired output and get the required input."),
  slippageBps: z.number().int().min(0).max(10_000).default(50).describe("Max slippage in basis points (e.g. 50 = 0.50%, 100 = 1%). Default: 50"),
  // 20 minutes, not 5. The deadline starts when this tool runs, but the swap
  // isn't signed until a human has read the confirmation sheet — and this
  // wallet's whole premise is that they should read it, decode the calldata and
  // check it elsewhere before signing. A 5-minute window meant a user who did
  // exactly what we ask them to do watched the final step revert on deadline
  // while every earlier step still simulated fine.
  //
  // The deadline is not the thing protecting them from a stale price: minOut
  // does that, and it is unchanged. The deadline only bounds how long a signed
  // transaction may sit in the mempool, and 20 minutes is still conservative.
  deadlineSeconds: z.number().int().positive().max(86400).default(1200).describe("Transaction deadline in seconds from now (e.g. 1200 = 20 minutes). Default: 1200"),
  owner: addressSchema.optional().describe("The address that owns the input tokens (0x...). Defaults to the connected wallet."),
  finalTo: addressSchema.optional().describe("Address to receive the output tokens (0x...). Defaults to the owner address."),
  router: addressSchema.optional().describe("Override the zRouter contract address (0x...). Defaults to the canonical zRouter for the chain."),
});

export const intentSwap = createTool({
  name: "intentSwap", description: "Prepare a versioned unsigned swap proposal. Native host owns approval and signing. Unverified routes are unavailable.",
  parameters: swapParameters,
  execute: async (client, args) => {
    try {
      const owner = (args.owner ?? await client.getAddress()).toLowerCase();
      if (owner !== (await client.getAddress()).toLowerCase()) throw new Error("Captured account mismatch");
      const router = zRouterAddress(args.chainId), quoter = zQuoterAddress(args.chainId);
      if (!router || !quoter) return unavailableSwap(args, "No direct quoter configured. Use getNativeSwapProposal for a captured API request.", "zquoter");
      if (args.router && args.router.toLowerCase() !== router.toLowerCase()) throw new Error("Router override is not authenticated");
      const rpc = client.getPublicClient(args.chainId);
      const [sell, buy] = await Promise.all([resolveInputToToken(args.tokenIn, args.chainId, rpc), resolveInputToToken(args.tokenOut, args.chainId, rpc)]);
      if ((sell.id ?? 0n) !== 0n || (buy.id ?? 0n) !== 0n) throw new Error("Direct quoter cannot capture nonzero token IDs");
      const amount = toBaseUnits(args.amount, args.side === "EXACT_IN" ? sell : buy);
      const recipient = args.finalTo ?? owner;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + args.deadlineSeconds);
      // The human-unit compatibility entry point obtains a bound, then the versioned builder
      // re-reads and authenticates its executable call. A changed bound fails closed.
      const built = await buildBestSwap(rpc, { chainId: args.chainId, to: recipient as any, exactOut: args.side === "EXACT_OUT", tokenIn: sell.address, tokenOut: buy.address, swapAmount: amount, slippageBps: args.slippageBps, deadline });
      if (!built) throw new Error("Quoter unavailable");
      const limit = built.amountLimit;
      return await buildNativeSwapProposal(client, { schemaVersion: 1, requestId: "intentSwap", owner, chainId: args.chainId,
        recipient, sellAsset: { address: sell.address, id: (sell.id ?? 0n).toString() }, buyAsset: { address: buy.address, id: (buy.id ?? 0n).toString() },
        mode: args.side, amountRaw: amount.toString(), boundRaw: limit.toString(), deadline: deadline.toString(), slippageBps: args.slippageBps, source: "zquoter" });
    } catch (error) { return unavailableSwap(args, error instanceof Error ? error.message : "Swap unavailable", "zquoter", "failed"); }
  },
});
