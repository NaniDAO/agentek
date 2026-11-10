import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { failedResult, type BaseTool, type AgentekClient } from "@agentek/tools/client";

export default function AgentekTool(
  agentekClient: AgentekClient,
  baseTool: BaseTool,
): Tool {
  return tool({
    description: baseTool.description,
    inputSchema: baseTool.parameters,
    execute: async (args: z.infer<typeof baseTool.parameters>) => {
      // Errors are rethrown rather than returned as the result. Returning
      // `e.message` made a failure indistinguishable from data: the AI SDK saw
      // a successful call whose value happened to be an error sentence, so the
      // model had no signal to retry and nothing downstream could tell that
      // the tool had failed at all.
      const result = await agentekClient.execute(baseTool.name, args);
      if (failedResult(result)) throw new Error("Tool returned no successful result: " + JSON.stringify(result));
      return result;
    },
  });
}

/** @deprecated Use BaseTool. */
export type ToolDefinition = Pick<BaseTool, "name" | "description" | "parameters">;
/** @deprecated Tool execution returns the value directly, without a result envelope. */
export interface ToolResult<T = unknown> { result: T }
