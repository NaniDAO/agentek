import type { CoreTool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import {
  type BaseTool,
  createNaniClient,
  type NaniClient,
} from "../shared/client";

export default function NaniTool(
  naniClient: NaniClient,
  baseTool: BaseTool,
): CoreTool {
  return tool({
    description: baseTool.description,
    parameters: baseTool.parameters,
    execute: (args: z.infer<typeof baseTool.parameters>) => {
      return naniClient.execute(baseTool.name, args);
    },
  });
}
