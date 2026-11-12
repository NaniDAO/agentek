import type { Tool, ToolExecutionOptions } from "ai";
import * as z from "zod";
import { assertToolInput, failedResult, type BaseTool, type AgentekClient } from "@agentek/tools/client";
import { toolInputSchema } from "@agentek/tools/schema";

export default function AgentekTool(
  agentekClient: AgentekClient,
  baseTool: BaseTool,
): Tool {
  const definition = {
    description: baseTool.description,
    // The SDK validates before execute(). Apply budgets at that boundary too.
    inputSchema: {
      "~standard": {
        version: 1 as const,
        vendor: "agentek",
        validate: async (value: unknown) => {
          try { assertToolInput(value); }
          catch { return {issues: [{message: "Tool input exceeds supported resource limits"}]}; }
          const result = await baseTool.parameters.safeParseAsync(value);
          return result.success ? {value: result.data} : {issues: result.error.issues};
        },
        jsonSchema: {
          input: () => toolInputSchema(baseTool.parameters),
          output: () => { throw new Error("Agentek tool inputs do not define an output JSON schema"); },
        },
      },
    },
    execute: async (args: z.infer<typeof baseTool.parameters>, options?: ToolExecutionOptions) => {
      // Errors are rethrown rather than returned as the result. Returning
      // `e.message` made a failure indistinguishable from data: the AI SDK saw
      // a successful call whose value happened to be an error sentence, so the
      // model had no signal to retry and nothing downstream could tell that
      // the tool had failed at all.
      const result = await agentekClient.execute(baseTool.name, args, options?.toolCallId ? { requestId: options.toolCallId } : undefined);
      if (failedResult(result)) throw new Error("Tool returned no successful result");
      return result;
    },
  };
  return definition as unknown as Tool;
}

/** @deprecated Use BaseTool. */
export type ToolDefinition = Pick<BaseTool, "name" | "description" | "parameters">;
/** @deprecated Tool execution returns the value directly, without a result envelope. */
export interface ToolResult<T = unknown> { result: T }
