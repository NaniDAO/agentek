import { BaseTool, createToolCollection } from "../client.js";
import { getLatestTokens } from "./tools.js";

export function dexscreenerTools(): BaseTool[] {
  return createToolCollection([getLatestTokens]);
}
