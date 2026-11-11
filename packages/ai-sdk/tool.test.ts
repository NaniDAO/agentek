import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import AgentekTool from "./tool.js";

describe("AI SDK host request identity", () => {
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
