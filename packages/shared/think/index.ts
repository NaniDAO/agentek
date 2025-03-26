import { BaseTool, createToolCollection } from "../client.js";
import { thinkTool } from "./tools.js";

// modalities of thought
export function thinkTools(): BaseTool[] {
  return createToolCollection([thinkTool]);
}
