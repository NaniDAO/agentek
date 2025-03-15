import { BaseTool, createToolCollection } from "../client";
import { getCryptoPriceTool } from "./tools";

export function cryptoPriceTools(): BaseTool[] {
  return createToolCollection([getCryptoPriceTool]);
}