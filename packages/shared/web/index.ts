import { BaseTool, createToolCollection } from "../client.js";
import { scrapeWebContent } from "./tools.js";

/**
 * Export an array of tools for researching web content.
 */
export function webTools(): BaseTool[] {
  return createToolCollection([scrapeWebContent]);
}
