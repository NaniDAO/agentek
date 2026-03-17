import { BaseTool, createToolCollection } from "../client.js";
import { resolveTokenTool } from "./tools.js";

export function resolveTokenTools(): BaseTool[] {
  return createToolCollection([resolveTokenTool]);
}
