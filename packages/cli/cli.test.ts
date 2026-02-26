import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "dist/index.mjs");

/**
 * Subprocess timeout — CLI init loads 150+ tools (~2-3s), plus the RPC call
 * itself. 60s is generous enough for flaky public RPCs.
 */
const SUBPROCESS_TIMEOUT = 60_000;

/** Vitest per-test timeout — must exceed SUBPROCESS_TIMEOUT. */
const TEST_TIMEOUT = 90_000;

/** Run the CLI with given args and return { stdout, stderr, exitCode }. */
function run(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, ...args],
      { timeout: SUBPROCESS_TIMEOUT },
      (err, stdout, stderr) => {
        const exitCode = err && "code" in err ? (err as any).code as number : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}

/** Parse stdout as JSON, failing the test if it's not valid JSON. */
function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Expected valid JSON, got:\n${stdout}`);
  }
}

// ── Usage / help ─────────────────────────────────────────────────────────

describe("CLI — usage & help", () => {
  it("no args should print usage to stderr and exit 2", async () => {
    const { stdout, stderr, exitCode } = await run([]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("agentek list");
    expect(stdout).toBe("");
  });

  it("help should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["help"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });

  it("--help should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });

  it("unknown command should print usage to stderr and exit 2", async () => {
    const { stderr, exitCode } = await run(["bogus"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Usage:");
  });
});

// ── list ──────────────────────────────────────────────────────────────────

describe("CLI — list", () => {
  it("should return a sorted JSON array of tool names", async () => {
    const { stdout, exitCode } = await run(["list"]);
    expect(exitCode).toBe(0);

    const names = parseJson(stdout);
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(100);

    // Verify sorted
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);

    // Spot-check well-known tools
    expect(names).toContain("getBlockNumber");
    expect(names).toContain("getBalance");
    expect(names).toContain("resolveENS");
  }, TEST_TIMEOUT);
});

// ── info ──────────────────────────────────────────────────────────────────

describe("CLI — info", () => {
  it("should return tool info with schema for a known tool", async () => {
    const { stdout, exitCode } = await run(["info", "getBlockNumber"]);
    expect(exitCode).toBe(0);

    const info = parseJson(stdout);
    expect(info.name).toBe("getBlockNumber");
    expect(typeof info.description).toBe("string");
    expect(info.description.length).toBeGreaterThan(0);
    expect(info.parameters).toBeDefined();
    expect(info.parameters.type).toBe("object");
    expect(info.parameters.properties).toHaveProperty("chainId");
    expect(Array.isArray(info.supportedChains)).toBe(true);
    expect(info.supportedChains.length).toBeGreaterThan(0);
    expect(info.supportedChains[0]).toHaveProperty("id");
    expect(info.supportedChains[0]).toHaveProperty("name");
  }, TEST_TIMEOUT);

  it("should error for unknown tool", async () => {
    const { stderr, exitCode } = await run(["info", "nonExistentTool"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Unknown tool");
  }, TEST_TIMEOUT);

  it("should error when no tool name is given", async () => {
    const { stderr, exitCode } = await run(["info"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  }, TEST_TIMEOUT);
});

// ── exec ──────────────────────────────────────────────────────────────────

describe("CLI — exec", () => {
  it("should execute getBlockNumber on Base and coerce chainId to number", async () => {
    // Uses Base (8453) — faster and more reliable than mainnet in CI
    const { stdout, exitCode } = await run(["exec", "getBlockNumber", "--chainId", "8453"]);
    expect(exitCode).toBe(0);

    const result = parseJson(stdout);
    // chainId is coerced from string "8453" → number 8453 via Zod schema
    expect(result.chainId).toBe(8453);
    expect(typeof result.blockNumber).toBe("string");
    expect(Number(result.blockNumber)).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("should error for unknown tool", async () => {
    const { stderr, exitCode } = await run(["exec", "invalidTool", "--foo", "bar"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Unknown tool");
  }, TEST_TIMEOUT);

  it("should error when no tool name is given", async () => {
    const { stderr, exitCode } = await run(["exec"]);
    expect(exitCode).toBe(1);

    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  }, TEST_TIMEOUT);
});
