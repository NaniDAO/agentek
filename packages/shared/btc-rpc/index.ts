import { BaseTool, createToolCollection } from "../client.js";
import {
  getLatestBtcBlock,
  getBlockTxids,
  getBtcTxDetails,
  getBtcAddressInfo
} from "./tools.js";

export function btcRpcTools(): BaseTool[] {
  return createToolCollection([
    getLatestBtcBlock,
    getBlockTxids,
    getBtcTxDetails,
    getBtcAddressInfo
  ]);
}
