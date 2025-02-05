import { BaseTool, createToolCollection } from "../client";
import { checkAllowanceTool } from "./intents";

export function allowanceTools(): BaseTool[] {
  return createToolCollection([checkAllowanceTool]);
}
