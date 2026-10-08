import { BaseTool, createToolCollection } from "../client.js";
import { quoteNaniBatchTool } from "./batch.js";
import { quoteNaniNativeMaxTool } from "./native-max.js";
import { estimateGasCostTool } from "./tools.js";

export function gasEstimatorTools(): BaseTool[] {
  return createToolCollection([estimateGasCostTool, quoteNaniBatchTool, quoteNaniNativeMaxTool]);
}