import { createToolCollection } from "../client";
import type { BaseTool } from "../client";
import { createCoindeskNewsTool } from "./tools";

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
