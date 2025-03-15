import { BaseTool, createToolCollection } from "../client";
import { intentTransferTool, intentTransferFromTool } from "./intents";

export function transferTools(): BaseTool[] {
  return createToolCollection([intentTransferTool, intentTransferFromTool]);
}
