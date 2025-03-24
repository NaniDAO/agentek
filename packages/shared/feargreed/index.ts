import { BaseTool, createToolCollection } from "../client.js";
import { fearGreedIndexTool } from "./tools.js";

export function fearGreedIndexTools(): BaseTool[] {
  return createToolCollection([fearGreedIndexTool]);
}
