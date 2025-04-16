import { BaseTool, createToolCollection } from "../client.js";
import { createImageGenAndPinTool } from "./tools.js";

export interface ImageGenToolOptions {
  fireworksApiKey: string;
  pinataJWT: string;
}

export function createImageGenTools({
  fireworksApiKey,
  pinataJWT,
}: ImageGenToolOptions): BaseTool[] {
  return createToolCollection([createImageGenAndPinTool({
    fireworksApiKey,
    pinataJWT,
  })]);
}
