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
import { intentSendTransaction } from "./intents.js";

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
    intentSendTransaction,
  ]);
}
