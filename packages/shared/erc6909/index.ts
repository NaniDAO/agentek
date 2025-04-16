import { BaseTool, createToolCollection } from "../client.js";
import { intentCreateCoinToken } from "./intents.js";
import { getCoinTokenMetadata, getCoinBalance } from "./tools.js";

export function erc6909Tools(): BaseTool[] {
  return createToolCollection([
    // tools
    getCoinTokenMetadata,
    getCoinBalance,

    // intents
    intentCreateCoinToken,
  ]);
}
