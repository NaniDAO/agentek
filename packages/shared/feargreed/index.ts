import { BaseTool, createToolCollection } from "../client";
import { fearGreedIndexTool } from "./tools";

export function fearGreedIndexTools(): BaseTool[] {
  return createToolCollection([fearGreedIndexTool]);
}
