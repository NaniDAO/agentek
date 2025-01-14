import type { CoreTool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import NaniClient from "../shared/client";

export default function NaniTool(
  naniClient: NaniClient,
  method: string,
  description: string,
  schema: z.ZodObject<any, any, any, any, { [x: string]: any }>,
): CoreTool {
  return tool({
    description: description,
    parameters: schema,
    execute: (arg: z.output<typeof schema>) => {
      return naniClient.run(method, arg);
    },
  });
}
