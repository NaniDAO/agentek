import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import AgentekTool from "./tool.js";

describe("AI SDK host request identity", () => {
  it("applies resource limits before the SDK validates record children", async () => {
    const child = vi.fn((value: unknown) => value);
    const parameters = z.object({headers: z.record(z.string(), z.preprocess(child, z.string()))});
    const adapter = AgentekTool({execute: vi.fn()} as any, {name: "fixture", description: "fixture", parameters} as any);
    const standard = (adapter.inputSchema as any)["~standard"];
    const result = await standard.validate({headers: Object.fromEntries(Array.from({length: 2048}, (_, i) => [String(i), null]))});
    expect(result.issues).toHaveLength(1);
    expect(child).not.toHaveBeenCalled();
    expect(await standard.validate({headers: {accept: "application/json"}})).toEqual({value: {headers: {accept: "application/json"}}});
    expect(standard.jsonSchema.input()).toMatchObject({type: "object", properties: {headers: {type: "object"}}});
  });
  it("passes the SDK tool call ID to the client for durable deduplication", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const client = { execute } as any;
    const base = { name: "fixture", description: "fixture", parameters: z.object({ value: z.string() }) } as any;
    const adapter = AgentekTool(client, base);
    await adapter.execute!({ value: "same-action" }, { toolCallId: "call-stable-1", messages: [] });
    expect(execute).toHaveBeenCalledWith("fixture", { value: "same-action" }, { requestId: "call-stable-1" });
  });

  it("does not invent a request identifier when the host omitted it", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const adapter = AgentekTool({ execute } as any, { name: "fixture", description: "fixture", parameters: z.object({}) } as any);
    await (adapter.execute as any)({});
    expect(execute).toHaveBeenCalledWith("fixture", {}, undefined);
  });
});
