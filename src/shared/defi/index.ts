import { BaseTool, createToolCollection } from "../client";
import { swapTool } from "./swap";

export function defiTools(): BaseTool[] {
  return createToolCollection([swapTool]);
}
