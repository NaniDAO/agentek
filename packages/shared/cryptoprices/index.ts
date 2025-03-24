import { BaseTool, createToolCollection } from "../client.js";
import { getCryptoPriceTool } from "./tools.js";

export function cryptoPriceTools(): BaseTool[] {
  return createToolCollection([getCryptoPriceTool]);
}