import { BaseTool, createToolCollection } from "../client";
import {
  getBalance,
  getCode,
  getTransactionCount,
  getBlock,
  getBlockNumber,
  getGasPrice,
  estimateGas,
  getFeeHistory,
  getTransaction,
  getTransactionReceipt,
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
    getFeeHistory,
    getTransaction,
    getTransactionReceipt,
  ]);
}
