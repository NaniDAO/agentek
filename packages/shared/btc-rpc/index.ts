import { BaseTool, createToolCollection } from "../client.js";
import {
  getLatestBtcBlock,
  getBtcTxDetails,
  getBtcAddressInfo
} from "./tools.js";

export function btcRpcTools(): BaseTool[] {
  return createToolCollection([
    getLatestBtcBlock,
    getBtcTxDetails,
    getBtcAddressInfo
  ]);
}
