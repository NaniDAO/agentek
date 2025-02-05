import { BaseTool, createToolCollection } from "../client";
import { intentNFTApproveTool } from "./intents";

export function nftApproveTools(): BaseTool[] {
  return createToolCollection([intentNFTApproveTool]);
}