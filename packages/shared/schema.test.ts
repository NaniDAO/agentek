import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allTools } from "./index.js";
import { solanaTools } from "./solana/index.js";
import { x402Tools } from "./x402/index.js";
import { twitterTools } from "./twitter/index.js";
import { webTools } from "./web/index.js";
import { credentialTools } from "./credentialTools/index.js";
import { toolInputSchema } from "./schema.js";

describe("model-facing input schemas", () => {
  it("exports every catalogue schema without network access or unresolved refs", async () => {
    const tools = [...await allTools({perplexityApiKey: "fixture", tallyApiKey: "fixture", coindeskApiKey: "fixture", coinMarketCalApiKey: "fixture", fireworksApiKey: "fixture", pinataJWT: "fixture"}),
      ...solanaTools(), ...x402Tools(), ...webTools(), ...await twitterTools({xBearerToken: "fixture"}), ...credentialTools()];
    for (const tool of tools) {
      const schema = toolInputSchema(tool.parameters);
      expect(schema.type, tool.name).toBe("object");
      expect(schema.properties, tool.name).toBeDefined();
      expect(JSON.stringify(schema), tool.name).not.toContain('"$ref"');
    }
  });
  it("describes input transformations, bounds, defaults and required fields", () => {
    const schema = toolInputSchema(z.object({
      amount: z.string().regex(/^[0-9]+$/).transform(BigInt),
      count: z.number().int().min(1).max(10).default(2),
      note: z.string().min(2).max(100).nullable().optional(),
      modes: z.array(z.enum(["read", "prepare"])).min(1).max(4),
    }).strict());
    expect(schema.required).toEqual(["amount", "modes"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.amount).toMatchObject({type: "string", pattern: "^[0-9]+$"});
    expect(schema.properties.count).toEqual({type: "integer", minimum: 1, maximum: 10, default: 2});
    expect(schema.properties.modes).toEqual({type: "array", items: {type: "string", enum: ["read", "prepare"]}, minItems: 1, maxItems: 4});
    expect(schema.properties.note.anyOf).toContainEqual({type: "null"});
  });
  it("keeps union, record and pipeline input semantics", () => {
    expect(toolInputSchema(z.string().pipe(z.coerce.number()))).toEqual({type: "string"});
    expect(toolInputSchema(z.union([z.literal("all"), z.number()])).anyOf).toHaveLength(2);
    expect(toolInputSchema(z.record(z.string().regex(/^0x/), z.boolean()))).toEqual({type: "object", additionalProperties: {type: "boolean"}, propertyNames: {pattern: "^0x"}});
  });
  it("rejects unsupported schemas rather than silently weakening validation", () => {
    expect(() => toolInputSchema(z.date())).toThrow(/Unsupported tool schema/);
    expect(() => toolInputSchema(z.lazy(() => z.string()))).toThrow(/Unsupported tool schema/);
  });
});
