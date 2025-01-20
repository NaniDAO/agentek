import { BaseTool, createToolCollection } from "../client";
import {
  getBalance,
  getCode,
  getTransactionCount,
  getBlock,
  getBlockNumber,
  getGasPrice,
  estimateGas,
} from "./tools";

export function rpcTools(): BaseTool[] {
  return createToolCollection([
    getBalance,
    getCode,
    getTransactionCount,
    getBlock,
    getBlockNumber,
    getGasPrice,
    estimateGas,
  ]);
}
