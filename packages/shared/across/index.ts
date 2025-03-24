import { BaseTool, createToolCollection } from "../client.js";
import { getAcrossFeeQuote } from "./tools.js";
import { intentDepositAcross } from "./intents.js";

export function acrossTools(): BaseTool[] {
  return createToolCollection([getAcrossFeeQuote, intentDepositAcross]);
}
