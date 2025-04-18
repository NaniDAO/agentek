import { BaseTool, createToolCollection } from "../client.js";
import {
  createCheckCreditsTool
} from "./tools.js";
import {
  createIntentTopUpTool
}  from './intents.js'


/**
 * Export all OpenRouter tools as a collection
 */
export function createOpenRouterTools({
  openrouterApiKey,
}: {
  openrouterApiKey: string;
}): BaseTool[] {
  return createToolCollection([
    createCheckCreditsTool(openrouterApiKey),
    createIntentTopUpTool(openrouterApiKey),
  ]);
}
