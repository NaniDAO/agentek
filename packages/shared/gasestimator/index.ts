import { BaseTool, createToolCollection } from "../client.js";
import { estimateGasCostTool } from "./tools.js";

export function gasEstimatorTools(): BaseTool[] {
  return createToolCollection([estimateGasCostTool]);
}