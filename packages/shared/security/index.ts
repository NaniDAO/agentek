import { BaseTool, createToolCollection } from "../client.js";
import { checkMaliciousAddress, checkMaliciousWebsite } from "./tools.js";

/**
 * Export an array of tools for security checks.
 */
export function securityTools(): BaseTool[] {
  const tools = [checkMaliciousAddress, checkMaliciousWebsite];

  return createToolCollection(tools);
}
