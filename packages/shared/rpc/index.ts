import { BaseTool, createToolCollection } from "../client.js";
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
} from "./tools.js";

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
