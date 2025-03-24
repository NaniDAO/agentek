import { getNFTMetadataTool } from "./tools.js";
import { createToolCollection, BaseTool } from "../client.js";

export function nftTools(): BaseTool[] {
  return createToolCollection([
    getNFTMetadataTool
  ]);
}
