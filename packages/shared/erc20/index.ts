import { BaseTool, createToolCollection } from "../client.js";
import { observeWalletAsset } from "./observations.js";
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
    observeWalletAsset,
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

export { observeWalletAsset, observeAsset } from "./observations.js";
