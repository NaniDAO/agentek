import { BaseTool, createToolCollection } from "../client";
import { checkNFTOwnerTool } from "./intents";

export function nftOwnerTools(): BaseTool[] {
  return createToolCollection([checkNFTOwnerTool]);
}