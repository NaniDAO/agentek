import { BaseTool, createToolCollection } from "../client.js";
import {
  x402FetchTool,
  getX402PaymentInfoTool,
  x402DiscoverResourcesTool,
} from "./tools.js";

export function x402Tools(): BaseTool[] {
  return createToolCollection([
    x402FetchTool,
    getX402PaymentInfoTool,
    x402DiscoverResourcesTool,
  ]);
}
