import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const require = createRequire(import.meta.url);
const cjs = require("zod").z as typeof z;

describe.each([["ESM", z], ["CommonJS", cjs]] as const)("patched Zod 3 collection bounds (%s)", (_format, schema) => {
  for (const kind of ["array max", "array length", "set max", "set size"] as const) {
    for (const asynchronous of [false, true]) {
      it(`${kind} rejects oversized collections before parsing children (${asynchronous ? "async" : "sync"})`, async () => {
        const child = vi.fn((value: unknown) => value);
        const refinement = vi.fn(() => true);
        const element = schema.preprocess(child, schema.number());
        const bounded = kind === "array max" ? schema.array(element).max(2)
          : kind === "array length" ? schema.array(element).length(2)
          : kind === "set max" ? schema.set(element).max(2) : schema.set(element).size(2);
        const guarded = bounded.refine(refinement);
        const values = Array.from({ length: 4096 }, (_, index) => index);
        const input = kind.startsWith("array") ? values : new Set(values);
        const result = asynchronous ? await guarded.safeParseAsync(input) : guarded.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues).toMatchObject([{ code: "too_big", maximum: 2 }]);
        expect(child).not.toHaveBeenCalled();
        expect(refinement).not.toHaveBeenCalled();
      });
    }
  }

  it("preserves ordinary child parsing, transformations and lower-bound diagnostics", () => {
    const child = vi.fn((value: unknown) => Number(value));
    const element = schema.preprocess(child, schema.number());
    expect(schema.array(element).max(2).parse(["1", "2"])).toEqual([1, 2]);
    expect(child).toHaveBeenCalledTimes(2);
    child.mockClear();
    const result = schema.array(element).min(2).safeParse(["1"]);
    expect(result.success).toBe(false);
    expect(child).toHaveBeenCalledTimes(1);
  });
});
