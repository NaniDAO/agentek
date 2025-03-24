import { BaseTool, createToolCollection } from "../client.js";
import { lookupENSTool, resolveENSTool } from "./tools.js";

export function ensTools(): BaseTool[] {
  return createToolCollection([resolveENSTool, lookupENSTool]);
}
