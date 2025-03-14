import { createToolCollection } from "../client";
import { getL2DepositsTool, getL2WithdrawalsTool } from "./tools";

export const l2Tools = () => createToolCollection([
  getL2DepositsTool,
  getL2WithdrawalsTool,
]);