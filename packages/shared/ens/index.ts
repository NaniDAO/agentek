import { z } from "zod";
import { BaseTool, createToolCollection, createTool } from "../client.js";
import { Address, encodeFunctionData } from "viem";
import { namehash, normalize } from "viem/ens";
import { lookupENSTool, resolveENSTool, checkNameAvailabilityTool, checkENSNameStatusTool, getENSMetaTool } from "./tools.js";
import { intentRegisterENSName } from "./intents.js";

export function ensTools(): BaseTool[] {
  return createToolCollection([
    resolveENSTool,
    lookupENSTool,
    checkNameAvailabilityTool,
    checkENSNameStatusTool,
    getENSMetaTool,
    intentRegisterENSName
  ]);
}
