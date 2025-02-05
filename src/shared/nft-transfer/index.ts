import { BaseTool, createToolCollection } from "../client";
import { intentNFTTransferTool, intentNFTSafeTransferTool } from "./intents";

export function nftTransferTools(): BaseTool[] {
  return createToolCollection([intentNFTTransferTool, intentNFTSafeTransferTool]);
}