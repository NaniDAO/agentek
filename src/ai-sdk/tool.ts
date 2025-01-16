import type { CoreTool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { type BaseTool, type AgentekClient } from "../shared/client";

export default function AgentekTool(
  agentekClient: AgentekClient,
  baseTool: BaseTool,
): CoreTool {
  return tool({
    description: baseTool.description,
    parameters: baseTool.parameters,
    execute: (args: z.infer<typeof baseTool.parameters>) => {
      try {
        return agentekClient.execute(baseTool.name, args);
      } catch (e) {
        console.error("Execution error:", e);
        return e.message.toString() ?? "Unknown error";
      }
    },
  });
}
