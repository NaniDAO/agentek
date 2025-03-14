import { BaseTool, createToolCollection } from "../client";
import { estimateGasCostTool } from "./tools";

export function gasEstimatorTools(): BaseTool[] {
  return createToolCollection([estimateGasCostTool]);
}