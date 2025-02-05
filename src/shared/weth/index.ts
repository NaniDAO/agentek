import { BaseTool, createToolCollection } from "../client";
import { intentWithdrawWETH, intentDepositWETH } from "./intents";

export function wethTools(): BaseTool[] {
  return createToolCollection([intentDepositWETH, intentWithdrawWETH]);
}
