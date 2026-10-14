import { BaseTool, createToolCollection } from "../client.js";
import { getQuote } from "./tools.js";
import { getNativeSwapProposal } from "./proposal.js";
import { intentSwap } from "./intents.js";

export function zrouterTools(): BaseTool[] {
  return createToolCollection([getQuote, intentSwap, getNativeSwapProposal]);
}

export { getNativeSwapProposal, buildNativeSwapProposal, swapRequestSchema, validateSwapCall, validateSwapOps } from "./proposal.js";
export type { SwapRequest } from "./proposal.js";
