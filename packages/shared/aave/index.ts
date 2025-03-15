import { BaseTool, createToolCollection } from "../client";
import { getAaveUserData, getAaveReserveData } from "./tools";
import {
  intentAaveDeposit,
  intentAaveWithdraw,
  intentAaveBorrow,
  intentAaveRepay,
} from "./intents";

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
