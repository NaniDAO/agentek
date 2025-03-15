import { getNFTMetadataTool } from "./tools";
import { createToolCollection, BaseTool } from "../client";

export function nftTools(): BaseTool[] {
  return createToolCollection([
    getNFTMetadataTool
  ]);
}
