import { BaseTool, createToolCollection } from "../client.js";
import { getQuote } from "./tools.js";
import { intentSwap } from "./intents.js";

export function zrouterTools(): BaseTool[] {
  return createToolCollection([getQuote, intentSwap]);
}
