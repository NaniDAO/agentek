import { BaseTool, createToolCollection } from "../client.js";
import { intentWithdrawWETH, intentDepositWETH } from "./intents.js";

export function wethTools(): BaseTool[] {
  return createToolCollection([intentDepositWETH, intentWithdrawWETH]);
}
