import { BaseTool, createToolCollection } from "../client.js";
import { lookupENSTool, resolveENSTool, checkNameAvailabilityTool, checkENSNameStatusTool, getENSMetaTool } from "./tools.js";

export function ensTools(): BaseTool[] {
  return createToolCollection([
    resolveENSTool,
    lookupENSTool,
    checkNameAvailabilityTool,
    checkENSNameStatusTool,
    getENSMetaTool
  ]);
}
