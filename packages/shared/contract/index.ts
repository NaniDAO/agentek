import type { BaseTool } from "../client.js";
import { createToolCollection } from "../client.js";
import { readContractTool, intentWriteContractTool } from "./tools.js";

export function contractTools(): BaseTool[] {
  return createToolCollection([
    readContractTool,
    intentWriteContractTool,
  ]);
}
