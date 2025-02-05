import { BaseTool, createToolCollection } from "../client";
import { intentApproveTool } from "./intents";

export function approveTools(): BaseTool[] {
  return createToolCollection([intentApproveTool]);
}
