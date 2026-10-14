import { z } from "zod";
import { createTool, type BaseTool } from "../client.js";
import { unavailableSwap } from "../zrouter/proposal.js";

export const createMatchSwapTool = (_configuration: { zeroxApiKey: string; swapFeeRecipient?: string; swapFeeBps?: number; swapFeeToken?: "sellToken" | "buyToken" }): BaseTool => createTool({
  name: "intent0xSwap", description: "0x execution is unavailable until execution target/proxy and calldata economic semantics are independently authenticated locally. Never signs or submits.",
  parameters: z.object({ chainId: z.number().int().positive().safe(), fromToken: z.string(), toToken: z.string(), amount: z.string(), slippageBps: z.number().int().min(1).max(1000).default(100) }).strict(),
  execute: async (_client, args) => unavailableSwap(args, "Authoritative 0x execution target/proxy and calldata commitments unavailable locally; simulation cannot prove mined payout", "0x"),
});
