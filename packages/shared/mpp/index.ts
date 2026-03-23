import type { BaseTool } from "../client.js";
import { createToolCollection } from "../client.js";
import type { MppConfig } from "./tools.js";
import {
  createMppFetchTool,
  getMppPaymentInfoTool,
  mppDiscoverServicesTool,
} from "./tools.js";

export function mppTools(config: MppConfig = {}): BaseTool[] {
  return createToolCollection([
    createMppFetchTool(config),
    getMppPaymentInfoTool,
    mppDiscoverServicesTool,
  ]);
}
