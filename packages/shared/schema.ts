import * as z from "zod";

export type JsonSchema = Record<string, any>;

/** Export inputs for models; Zod remains the execution validator. */
export function toolInputSchema(schema: z.ZodType): JsonSchema {
  const { $schema, ...input } = z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    cycles: "throw",
    reused: "inline",
  });
  return input;
}
