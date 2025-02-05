import { BaseTool, createToolCollection } from "../client";
import {
  intentNFTTransferTool,
  intentNFTSafeTransferTool,
  intentNFTApproveTool,
} from "./intents";
import { checkNFTOwnerTool } from "./tools";

export function erc721Tools(): BaseTool[] {
  return createToolCollection([
    intentNFTApproveTool,
    intentNFTTransferTool,
    intentNFTSafeTransferTool,

    // tools
    checkNFTOwnerTool,
  ]);
}
