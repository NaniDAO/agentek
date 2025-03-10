import { BaseTool, createToolCollection } from "../client";
import { getAcrossFeeQuote } from "./tools";
import { intentDepositAcross } from "./intents";

export function acrossTools(): BaseTool[] {
  return createToolCollection([getAcrossFeeQuote, intentDepositAcross]);
}
