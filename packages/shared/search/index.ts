import { createAskPerplexitySearchTool } from "./tools.js";
import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";

export function searchTools({
  perplexityApiKey,
}: {
  perplexityApiKey: string;
}): BaseTool[] {
  if (!perplexityApiKey) {
    throw new Error("Perplexity API key is required.");
  }

  const askPerplexitySearch = createAskPerplexitySearchTool(perplexityApiKey);
  return createToolCollection([askPerplexitySearch]);
}
