import { BaseTool, createToolCollection } from "../client";
import { getLatestTokens } from "./tools";

export function dexscreenerTools(): BaseTool[] {
  return createToolCollection([getLatestTokens]);
}
