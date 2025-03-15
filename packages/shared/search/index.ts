import { createAskPerplexitySearchTool } from "./tools";
import { createToolCollection } from "../client";
import type { BaseTool } from "../client";

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
