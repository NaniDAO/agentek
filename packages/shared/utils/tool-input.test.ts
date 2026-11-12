import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTool } from "../client.js";
import { createReadOnlyTestClient } from "../test-helpers.js";
import { intentSendTransaction } from "../rpc/intents.js";
import { quoteNaniBatchTool } from "../gasestimator/batch.js";
import { assertToolInput, parseToolInputJSON, TOOL_INPUT_LIMITS } from "./tool-input.js";

describe("tool input resource limits", () => {
  it("rejects oversized and sparse arrays before client or direct-tool validation", async () => {
    const child = vi.fn((value: unknown) => value);
    const body = vi.fn(async () => "ok");
    const tool = createTool({name: "fixture", description: "fixture",
      parameters: z.object({values: z.array(z.preprocess(child, z.string()))}), execute: body});
    const client = createReadOnlyTestClient([tool]);
    for (const values of [Array(2048).fill(0), new Array(1_000_000)]) {
      await expect(client.execute(tool.name, {values})).rejects.toThrow(/collection limit/);
      await expect(tool.execute(client, {values})).rejects.toThrow(/collection limit/);
    }
    expect(child).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(await client.execute(tool.name, {values: ["ordinary"]})).toBe("ok");
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized ABI input in schemas exposed to upstream adapters", () => {
    const result = intentSendTransaction.parameters.safeParse({
      to: "0x1111111111111111111111111111111111111111", chainId: 1, abi: Array(2048).fill(0),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toMatchObject([{code: "too_big", maximum: 512}]);
  });

  it("bounds nested arbitrary values, cycles and repeated references", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i <= TOOL_INPUT_LIMITS.depth; i++) deep = {child: deep};
    expect(() => assertToolInput(deep)).toThrow(/depth limit/);
    const cycle: any = {}; cycle.self = cycle;
    expect(() => assertToolInput(cycle)).toThrow(/cycles/);
    const shared = Array(1024).fill(0);
    expect(() => assertToolInput(Array(20).fill(shared))).toThrow(/node limit/);
    expect(() => assertToolInput({args: [Array(2048).fill(null)]})).toThrow(/collection limit/);
    expect(() => assertToolInput({args: [1n, -1n, (1n << 256n) - 1n]})).not.toThrow();
    expect(() => assertToolInput({a: shared, b: shared})).not.toThrow();
  });

  it("counts UTF-8 bytes and rejects oversized JSON before parsing", () => {
    expect(() => parseToolInputJSON(" ".repeat(TOOL_INPUT_LIMITS.bytes + 1))).toThrow(/byte limit/);
    expect(() => parseToolInputJSON(JSON.stringify({text: "💎".repeat(TOOL_INPUT_LIMITS.bytes / 4)}))).toThrow(/byte limit/);
    expect(() => assertToolInput({text: "é".repeat(TOOL_INPUT_LIMITS.bytes / 2 + 1)})).toThrow(/byte limit/);
    expect(parseToolInputJSON('{"args":[1,"two"]}')).toEqual({args: [1, "two"]});
  });

  it("preserves the largest supported batch calldata envelope", () => {
    const input = {owner: "0x1111111111111111111111111111111111111111", chainId: 1,
      calls: Array.from({length: 32}, () => ({to: "0x2222222222222222222222222222222222222222",
        value: "0x0", data: `0x${"ab".repeat(65_536)}`}))};
    expect(() => assertToolInput(input)).not.toThrow();
    expect(quoteNaniBatchTool.parameters.safeParse(input).success).toBe(true);
    expect(parseToolInputJSON(JSON.stringify(input))).toEqual(input);
  });

  it("rejects accessor properties without invoking them", () => {
    const getter = vi.fn(() => []);
    const value = Object.defineProperty({}, "args", {get: getter, enumerable: true});
    const array = Object.defineProperty([null], 0, {get: getter});
    expect(() => assertToolInput(value)).toThrow(/accessors/);
    expect(() => assertToolInput(array)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("inspects non-enumerable schema properties before direct tool validation", async () => {
    const client = createReadOnlyTestClient([intentSendTransaction]);
    const input = Object.defineProperty({to: "0x1111111111111111111111111111111111111111", chainId: 1,
      abi: ["function f(uint256[] values)"], functionName: "f"}, "args", {value: [Array(2048).fill(1n)]});
    await expect(intentSendTransaction.execute(client, input)).rejects.toThrow(/collection limit/);
    const getter = vi.fn(() => [Array(2048).fill(1n)]);
    const accessor = Object.defineProperty({}, "args", {get: getter});
    expect(() => assertToolInput(accessor)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
  });
});
