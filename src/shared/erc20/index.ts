import { BaseTool, createToolCollection } from "../client";
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
    getAllowanceTool,
    getBalanceOfTool,
    getTotalSupplyTool,
    getDecimalsTool,
    getNameTool,
    getSymbolTool,
    getTokenMetadataTool,
  ]);
}
