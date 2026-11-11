import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("packaged MCP submission boundary", () => {
  it.each(["index.mjs", "index.cjs"])("rejects execute mode before registering tools (%s)", file => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./dist/${file}`, import.meta.url))], {
      env: {PATH: process.env.PATH, AGENTEK_EXECUTION_MODE: "execute", ACCOUNT: `0x${"1".repeat(40)}`},
      input: "", encoding: "utf8", timeout: 15_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("supports prepare mode only");
    expect(child.stderr).not.toContain("tools registered");
  });
});
