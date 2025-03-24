import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";
import { createCoindeskNewsTool } from "./tools.js";

export function coindeskTools({
  coindeskApiKey,
}: {
  coindeskApiKey: string;
}): BaseTool[] {
  if (!coindeskApiKey) {
    throw new Error("Coindesk API key is required for using these tools.");
  }

  return createToolCollection([
    // tools
    createCoindeskNewsTool(coindeskApiKey),
  ]);
}
