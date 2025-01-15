import { BaseTool, createToolCollection } from "../client";
import { lookupENSTool, resolveENSTool } from "./resolve-ens-name";

export function ensTools(): BaseTool[] {
  return createToolCollection([resolveENSTool, lookupENSTool]);
}
