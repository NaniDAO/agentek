import { BaseTool, createToolCollection } from "../client.js";
import { createMatchSwapTool } from "./intents.js";

/**
 * Export an array of tools for Matcha-based swaps.
 */
export function swapTools({
  zeroxApiKey,
  swapFeeRecipient,
  swapFeeBps,
  swapFeeToken,
}: {
  zeroxApiKey: string;
  /** Address to receive integrator/affiliate fees. */
  swapFeeRecipient?: string;
  /** Fee in basis points (e.g. 10 = 0.1%). */
  swapFeeBps?: number;
  /** Which token the fee is taken from: "sellToken" or "buyToken". */
  swapFeeToken?: "sellToken" | "buyToken";
}): BaseTool[] {
  const tools = [];
  if (zeroxApiKey) {
    tools.push(
      createMatchSwapTool({
        zeroxApiKey,
        swapFeeRecipient,
        swapFeeBps,
        swapFeeToken,
      }),
    );
  }

  return createToolCollection(tools);
}
