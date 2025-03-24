import { BaseTool, createToolCollection } from "../client.js";
import { intentApproveTool } from "./intents.js";
import {
  getAllowanceTool,
  getBalanceOfTool,
  getTotalSupplyTool,
  getDecimalsTool,
  getNameTool,
  getSymbolTool,
  getTokenMetadataTool,
} from "./tools.js";

export function erc20Tools(): BaseTool[] {
  return createToolCollection([
    // tools
    getAllowanceTool,
    getBalanceOfTool,
    getTotalSupplyTool,
    getDecimalsTool,
    getNameTool,
    getSymbolTool,
    getTokenMetadataTool,

    // intents
    intentApproveTool,
  ]);
}
