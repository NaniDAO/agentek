import { BaseTool, createToolCollection } from "../client.js";
import { createMatchSwapTool } from "./intents.js";

/**
 * Export an array of tools for Matcha-based swaps.
 */
export function swapTools({
  zeroxApiKey,
}: {
  zeroxApiKey: string;
}): BaseTool[] {
  const tools = [];
  if (zeroxApiKey) {
    tools.push(
      createMatchSwapTool({
        zeroxApiKey,
      }),
    );
  }

  return createToolCollection(tools);
}
