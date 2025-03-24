import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { BaseTool, AgentekClient } from "@agentek/tools/client";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
}

export interface ToolResult {
  result: any;
}

export default function AgentekTool(
  agentekClient: AgentekClient,
  baseTool: BaseTool,
): Tool {
  return tool({
    description: baseTool.description,
    parameters: baseTool.parameters,
    execute: (args: z.infer<typeof baseTool.parameters>) => {
      return agentekClient.execute(baseTool.name, args).catch((e: Error) => {
        return e.message || "Could not process this function";
      });
    },
  });
}
