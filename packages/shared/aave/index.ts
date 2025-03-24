import { BaseTool, createToolCollection } from "../client.js";
import { getAaveUserData, getAaveReserveData } from "./tools.js";
import {
  intentAaveDeposit,
  intentAaveWithdraw,
  intentAaveBorrow,
  intentAaveRepay,
} from "./intents.js";

export function aaveTools(): BaseTool[] {
  return createToolCollection([
    getAaveUserData,
    getAaveReserveData,
    intentAaveDeposit,
    intentAaveWithdraw,
    intentAaveBorrow,
    intentAaveRepay,
  ]);
}
