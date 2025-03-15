import { BaseTool, createToolCollection } from "../client";
import { checkMaliciousAddress, checkMaliciousWebsite } from "./tools";

/**
 * Export an array of tools for security checks.
 */
export function securityTools(): BaseTool[] {
  const tools = [checkMaliciousAddress, checkMaliciousWebsite];

  return createToolCollection(tools);
}
