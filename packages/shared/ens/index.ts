import { BaseTool, createToolCollection } from "../client";
import { lookupENSTool, resolveENSTool } from "./tools";

export function ensTools(): BaseTool[] {
  return createToolCollection([resolveENSTool, lookupENSTool]);
}
