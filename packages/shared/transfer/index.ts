import { BaseTool, createToolCollection } from "../client.js";
import { intentTransferTool, intentTransferFromTool } from "./intents.js";

export function transferTools(): BaseTool[] {
  return createToolCollection([intentTransferTool, intentTransferFromTool]);
}
