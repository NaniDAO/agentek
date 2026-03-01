import type { BaseTool } from "@agentek/tools/client";
import { outputJson, outputError } from "../utils/output.js";

export function handleSearch(toolsMap: Map<string, BaseTool>, rest: string[]): never {
  const keyword = rest[0];
  if (!keyword) outputError("Usage: agentek search <keyword>");

  const pattern = keyword.toLowerCase();
  const matches: { name: string; description: string }[] = [];
  for (const [name, tool] of toolsMap) {
    if (
      name.toLowerCase().includes(pattern) ||
      tool.description.toLowerCase().includes(pattern)
    ) {
      matches.push({ name, description: tool.description });
    }
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));
  outputJson(matches);
}
