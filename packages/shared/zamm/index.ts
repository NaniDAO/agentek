import { BaseTool, createToolCollection } from "../client.js";
import { getCoin, getHolders, getAccountPortfolio, getPool, getSwaps } from "./tools.js";

export function zammTools(): BaseTool[] {
  return createToolCollection([getCoin, getHolders, getAccountPortfolio, getPool, getSwaps]);
}
