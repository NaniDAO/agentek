import type { BaseTool } from "@agentek/tools/client";
import { zodToJsonSchema } from "zod-to-json-schema";
import { outputJson, outputError } from "../utils/output.js";
import { unknownToolError } from "../utils/errors.js";

export function handleInfo(toolsMap: Map<string, BaseTool>, rest: string[]): never {
  const toolName = rest[0];
  if (!toolName) outputError("Usage: agentek info <tool-name>");

  const tool = toolsMap.get(toolName);
  if (!tool) unknownToolError(toolName, toolsMap);

  outputJson({
    name: tool!.name,
    description: tool!.description,
    parameters: zodToJsonSchema(tool!.parameters),
    supportedChains: tool!.supportedChains?.map((c) => ({ id: c.id, name: c.name })),
  });
}
