import { z } from "zod";
import { BaseTool, createToolCollection, createTool } from "../client.js";
import { lookupENSTool, resolveENSTool, checkNameAvailabilityTool, checkENSNameStatusTool, getENSMetaTool } from "./tools.js";
import { intentRegisterENSName } from "./intents.js";

export function ensTools(): BaseTool[] {
  return createToolCollection([
    resolveENSTool,
    lookupENSTool,
    checkNameAvailabilityTool,
    checkENSNameStatusTool,
    getENSMetaTool,
    intentRegisterENSName,
    // renew ens name
    // subdomain management
  ]);
}
