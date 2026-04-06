import type { BaseTool } from "../client.js";
import { createToolCollection } from "../client.js";
import {
  getActiveApprovalsTool,
  intentRevokeApprovalTool,
  intentRevokeAllApprovalsTool,
} from "./tools.js";

export function approvalTools(): BaseTool[] {
  return createToolCollection([
    getActiveApprovalsTool,
    intentRevokeApprovalTool,
    intentRevokeAllApprovalsTool,
  ]);
}
