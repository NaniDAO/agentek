import { BaseTool, createToolCollection } from "../client";
import { intentApproveTool } from "./intents";
import {
  getAllowanceTool,
  getBalanceOfTool,
  getTotalSupplyTool,
  getDecimalsTool,
  getNameTool,
  getSymbolTool,
  getTokenMetadataTool,
} from "./tools";

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
