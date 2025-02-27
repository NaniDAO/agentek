import { BaseTool, createToolCollection } from "../client";
import { scrapeWebContent } from "./tools";

/**
 * Export an array of tools for researching web content.
 */
export function webTools(): BaseTool[] {
  return createToolCollection([scrapeWebContent]);
}
