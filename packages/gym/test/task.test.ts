import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadTask,
  parseTask,
  TaskFileError,
  TaskValidationError,
} from "../src/task/loadTask.js";

const SPENDER = "0x1111111111111111111111111111111111111111";

const validTask = () => ({
  id: "approval-001",
  name: "Set an allowance",
  objective: "Set the spender's USDC allowance to exactly 500 USDC.",
  environment: { chain: "ethereum", blockNumber: 23_456_789 },
  wallet: { balances: { ETH: "10", USDC: "1000" } },
  tools: ["getAllowance", "intentApprove"],
  limits: {
    maxSteps: 20,
    maxTransactions: 10,
    maxReverts: 3,
    timeoutMs: 120_000,
  },
  graders: [
    {
      type: "allowance",
      token: "USDC",
      spender: SPENDER,
      operator: "eq",
      value: "500",
      tolerance: "0",
    },
    {
      type: "balance",
      asset: "ETH",
      operator: "gte",
      value: "5",
    },
  ],
});

describe("MVP task schema", () => {
  it("validates a task and applies agent account defaults", () => {
    const task = parseTask(validTask());
    expect(task.graders[0]).toMatchObject({ owner: "agent" });
    expect(task.graders[1]).toMatchObject({ account: "agent" });
    expect(task.environment.blockNumber).toBe(23_456_789);
  });

  it.each([
    ["RPC credentials in a task", (task: any) => {
      task.environment.upstreamRpcUrl = "https://secret.example/key";
    }],
    ["an unsupported grader", (task: any) => {
      task.graders = [{ type: "event", value: "Transfer" }];
    }],
    ["floating point numeric amounts", (task: any) => {
      task.wallet.balances.USDC = 1000.5;
    }],
    ["duplicate tools", (task: any) => {
      task.tools.push("getAllowance");
    }],
    ["unsafe block numbers", (task: any) => {
      task.environment.blockNumber = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["tolerance on an inequality", (task: any) => {
      task.graders[1].tolerance = "0.1";
    }],
    ["a one-turn model cap", (task: any) => {
      task.limits.maxModelRequests = 1;
    }],
    ["a model cap above 20", (task: any) => {
      task.limits.maxModelRequests = 21;
    }],
    ["a balance grader on an unconfigured chain", (task: any) => {
      task.graders[1].chain = "base";
    }],
    ["an allowance grader on an unconfigured chain", (task: any) => {
      task.graders[0].chain = "arbitrum";
    }],
    ["a contract-view grader on an unconfigured chain", (task: any) => {
      task.graders = [{ type: "contractView", chain: "base", address: SPENDER,
        abi: [{ type: "function", name: "answer", stateMutability: "view", inputs: [],
          outputs: [{ type: "uint256" }] }], functionName: "answer", operator: "eq", value: "1" }];
    }],
  ])("rejects %s", (_label, mutate) => {
    const task = validTask();
    mutate(task);
    expect(() => parseTask(task)).toThrow(TaskValidationError);
  });
});

describe("loadTask", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function taskPath(name: string, source: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "agentek-gym-task-"));
    directories.push(directory);
    const path = join(directory, name);
    await writeFile(path, source, "utf8");
    return path;
  }

  it("loads and validates YAML", async () => {
    const path = await taskPath(
      "approval.yaml",
      `id: approval-001
name: Set an allowance
objective: Set the spender allowance.
environment:
  chain: ethereum
  blockNumber: 23456789
wallet:
  balances:
    ETH: "10"
    USDC: "1000"
tools:
  - getAllowance
  - intentApprove
limits:
  maxSteps: 20
  maxTransactions: 10
  maxReverts: 3
  timeoutMs: 120000
graders:
  - type: allowance
    token: USDC
    spender: ${SPENDER}
    operator: eq
    value: "500"
`,
    );

    await expect(loadTask(path)).resolves.toMatchObject({
      id: "approval-001",
      graders: [{ type: "allowance", owner: "agent" }],
    });
  });

  it("loads JSON through the same validator", async () => {
    const path = await taskPath("approval.json", JSON.stringify(validTask()));
    await expect(loadTask(path)).resolves.toMatchObject({ id: "approval-001" });
  });

  it("keeps the ten-category smoke fixture genuinely category-diverse", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../examples/ten-category-smoke");
    const manifest = JSON.parse(await readFile(join(root, "suite.json"), "utf8")) as {
      expectedTasks: number;
      requireUniqueCategories: boolean;
      tasks: string[];
    };
    expect(manifest).toMatchObject({ expectedTasks: 10, requireUniqueCategories: true });
    const tasks = await Promise.all(manifest.tasks.map((path) => loadTask(join(root, path))));
    expect(tasks).toHaveLength(10);
    expect(new Set(tasks.map((task) => task.category)).size).toBe(10);
    expect(tasks.every((task) => task.limits.maxModelRequests === 10 ||
      task.limits.maxModelRequests === 20)).toBe(true);
  });

  it("rejects duplicate YAML keys", async () => {
    const path = await taskPath("invalid.yaml", "id: one\nid: two\n");
    await expect(loadTask(path)).rejects.toThrow(TaskFileError);
  });

  it("rejects aliases and multiple YAML documents", async () => {
    const aliasPath = await taskPath(
      "alias.yaml",
      "task: &task { id: one }\ncopy: *task\n",
    );
    await expect(loadTask(aliasPath)).rejects.toThrow(TaskFileError);

    const documentsPath = await taskPath(
      "multiple.yaml",
      "id: one\n---\nid: two\n",
    );
    await expect(loadTask(documentsPath)).rejects.toThrow(TaskFileError);
  });

  it("rejects unsupported file types before parsing", async () => {
    const path = await taskPath("task.txt", "{}");
    await expect(loadTask(path)).rejects.toThrow(/Unsupported task file extension/);
  });
});
