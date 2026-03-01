import type { BaseTool } from "@agentek/tools/client";
import { outputJson } from "../utils/output.js";

export function handleList(toolsMap: Map<string, BaseTool>): never {
  const names = Array.from(toolsMap.keys()).sort();
  outputJson(names);
}
