import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { compareAmounts } from "../src/graders/grade.js";
import { ToolHarness } from "../src/harness/ToolHarness.js";
import { aggregateCost, evaluateSafety } from "../src/runner/dimensions.js";
import {
  compareSavedReports,
  compareSuiteReports,
  fingerprintRunConfiguration,
  renderComparisonMarkdown,
  runSuite,
} from "../src/report/suite.js";
import { runEvaluation, type AgentAdapter } from "../src/runner/runEvaluation.js";

const hasAnvil = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;
const RECIPIENT = "0x000000000000000000000000000000000000bEEF";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No port"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function startUpstream(): Promise<{ child: ChildProcess; url: string }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--hardfork", "cancun", "--silent"],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await rpc(url, "eth_chainId");
      await rpc(url, "anvil_mine", ["0x1"]);
      return { child, url };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Upstream did not start");
}

async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe("grading and comparison", () => {
  it("separates same-model runs by inference settings and does not fabricate unknown costs", () => {
    const baseline = fingerprintRunConfiguration({ model: "same/model", provider: "openrouter",
      inferenceSettings: { temperature: 0.2 } });
    const variant = fingerprintRunConfiguration({ model: "same/model", provider: "openrouter",
      inferenceSettings: { temperature: 0.8 } });
    expect(baseline).not.toBe(variant);
    const cost = aggregateCost(2, [{ requestedModel: "same/model", costUsd: "0.001" }], []);
    expect(cost).toMatchObject({ modelCostUsd: "0.001", modelCostComplete: false });
    const safety = evaluateSafety({ safety: { allowedTransactionTargets: {
      ethereum: ["0x0000000000000000000000000000000000000001"],
    } } } as any, [{ hash: `0x${"1".repeat(64)}`, chainId: 1,
      to: "0x0000000000000000000000000000000000000002" }], []);
    expect(safety).toMatchObject({ evaluated: true, passed: false });
  });
  it("compares integer amounts with an equality tolerance", () => {
    expect(compareAmounts(100n, 100n, "eq")).toBe(true);
    expect(compareAmounts(101n, 100n, "eq", 1n)).toBe(true);
    expect(compareAmounts(102n, 100n, "eq", 1n)).toBe(false);
    expect(compareAmounts(100n, 101n, "gte")).toBe(false);
  });

  it("records a reverted receipt and stops subsequent transactions", async () => {
    const harness = new ToolHarness({
      maxSteps: 3, maxTransactions: 2, maxReverts: 0, timeoutMs: 30_000,
    });
    harness.start();
    const hash = `0x${"1".repeat(64)}`;
    await harness.beforeRequest("eth_sendRawTransaction");
    await harness.afterResponse("eth_sendRawTransaction", hash);
    await harness.afterResponse("eth_getTransactionReceipt", {
      transactionHash: hash,
      status: "0x0",
      gasUsed: "0x5208",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      logs: [],
    });
    expect(harness.getMetrics()).toMatchObject({ transactions: 1, reverts: 1, gasUsed: "21000" });
    expect(harness.getTermination()).toMatchObject({ reason: "MAX_REVERTS", actual: 1 });
    await expect(harness.beforeRequest("eth_sendRawTransaction")).rejects.toThrow(/MAX_REVERTS/);
  });
});

describe.runIf(hasAnvil)("suite runner", () => {
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    upstream = await startUpstream();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await stop(upstream?.child);
  });

  it("writes comparable JSON and Markdown artifacts from fresh forks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-gym-suite-"));
    tempDirs.push(directory);
    const task = (id: string) => ({
      id,
      name: id,
      objective: `Send 0.25 ETH to ${RECIPIENT}.`,
      environment: { chain: "ethereum", blockNumber: 1 },
      wallet: { balances: { ETH: "2" } },
      tools: ["getBalance", "intentTransfer"],
      limits: { maxSteps: 4, maxTransactions: 1, maxReverts: 0, timeoutMs: 30_000 },
      graders: [
        { type: "balance", asset: "ETH", account: RECIPIENT, operator: "gte", value: "0.25" },
      ],
    });
    await writeFile(join(directory, "first.json"), JSON.stringify(task("first")));
    await writeFile(join(directory, "second.json"), JSON.stringify(task("second")));
    const manifestPath = join(directory, "suite.json");
    await writeFile(manifestPath, JSON.stringify({
      id: "synthetic-transfer",
      expectedTasks: 2,
      tasks: ["first.json", "second.json"],
    }));
    const agent: AgentAdapter = {
      async run(context) {
        await context.execute("getBalance", { address: context.walletAddress, chainId: 1 });
        await context.execute("intentTransfer", {
          token: zeroAddress,
          amount: "0.25",
          to: RECIPIENT,
          chainId: 1,
        });
        return { completed: true };
      },
    };
    const outputDir = join(directory, "output");
    const report = await runSuite({
      manifestPath,
      outputDir,
      model: "programmatic-test-agent",
      upstreamRpcUrl: upstream.url,
      hardfork: "cancun",
      agent,
    });
    expect(report.passed).toBe(2);
    expect(report.total).toBe(2);
    expect(report.totals.transactions).toBe(2);
    expect(report.tasks.every((entry) => entry.transactions === 1)).toBe(true);
    expect(report.tasks[0].toolUsage).toEqual({ getBalance: 1, intentTransfer: 1 });
    expect(report.tasks.every((entry) => entry.gasUsed === "21000")).toBe(true);
    expect(report.tasks.every((entry) => entry.graders[0].passed)).toBe(true);
    expect(JSON.parse(await readFile(join(outputDir, "report.json"), "utf8"))).toMatchObject({ passed: 2 });
    expect(await readFile(join(outputDir, "report.md"), "utf8")).toContain("| first | — | PASS |");
    expect(await readFile(join(outputDir, "report.md"), "utf8")).toContain("getBalance ×1, intentTransfer ×1");
    const trace = JSON.parse(await readFile(join(outputDir, "tasks", "first", "trace.json"), "utf8"));
    expect(trace.transactions).toMatchObject([{ status: "success", gasUsed: "21000" }]);

    const failed = structuredClone(report);
    failed.model = report.model;
    failed.runId = "other-run";
    failed.inferenceSettings = { temperature: 0.8 };
    failed.runConfigurationFingerprint = fingerprintRunConfiguration({
      model: failed.model, provider: failed.provider, inferenceSettings: failed.inferenceSettings,
    });
    failed.tasks[1].success = false;
    failed.passed = 1;
    failed.passRate = 0.5;
    const comparison = compareSuiteReports([report, failed]);
    expect(comparison.models[0].model).toBe(comparison.models[1].model);
    expect(comparison.models[0].runConfigurationFingerprint)
      .not.toBe(comparison.models[1].runConfigurationFingerprint);
    expect(comparison.models[1].relativeToFirst.lost).toEqual(["second"]);
    expect(renderComparisonMarkdown(comparison)).toContain("| second | PASS | FAIL |");
    const changed = structuredClone(failed);
    changed.tasks[0].taskFingerprint = "different";
    expect(() => compareSuiteReports([report, changed])).toThrow(/same ordered task definitions/);

    const resumed = await runSuite({
      manifestPath,
      outputDir,
      model: "programmatic-test-agent",
      upstreamRpcUrl: upstream.url,
      hardfork: "cancun",
      resume: true,
      agent: {
        async run() {
          throw new Error("Resume should not rerun a completed task");
        },
      },
    });
    expect(resumed.passed).toBe(2);
    expect(resumed.runId).toBe(report.runId);
    await expect(runSuite({
      manifestPath, outputDir, model: "programmatic-test-agent", upstreamRpcUrl: upstream.url,
      hardfork: "cancun", resume: true, inferenceSettings: { temperature: 0.7 }, agent,
    })).rejects.toThrow(/inference settings/);

    const secondReportPath = join(directory, "other-report.json");
    await writeFile(secondReportPath, JSON.stringify(failed));
    const savedComparison = await compareSavedReports(
      [join(outputDir, "report.json"), secondReportPath],
      join(directory, "comparison"),
    );
    expect(savedComparison.models[1].relativeToFirst.lost).toEqual(["second"]);
    expect(await readFile(join(directory, "comparison", "comparison.md"), "utf8"))
      .toContain("| second | PASS | FAIL |");
  });

  it("checkpoints after one task and resumes only the unfinished task", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-gym-checkpoint-"));
    tempDirs.push(directory);
    const recipient = "0xA9e7000000000000000000000000000000000001";
    for (const id of ["one", "two"]) {
      await writeFile(join(directory, `${id}.json`), JSON.stringify({
        id, name: id, objective: `Transfer 0.1 ETH to ${recipient}`,
        environment: { chain: "ethereum", blockNumber: 1 },
        wallet: { balances: { ETH: "1" } },
        tools: ["intentTransfer"],
        limits: { maxSteps: 2, maxTransactions: 1, maxReverts: 0, timeoutMs: 30_000 },
        graders: [{ type: "balance", asset: "ETH", account: recipient, operator: "eq", value: "0.1" }],
      }));
    }
    const manifestPath = join(directory, "suite.json");
    await writeFile(manifestPath, JSON.stringify({ id: "checkpoint", expectedTasks: 2,
      tasks: ["one.json", "two.json"] }));
    const outputDir = join(directory, "output");
    let agentRuns = 0;
    const agent: AgentAdapter = { async run(context) {
      agentRuns += 1;
      await context.execute("intentTransfer", {
        token: zeroAddress, amount: "0.1", to: recipient, chainId: 1,
      });
      return { completed: true };
    } };
    const first = await runSuite({ manifestPath, outputDir, model: "test", upstreamRpcUrl: upstream.url,
      hardfork: "cancun", agent, stopAfter: 1 });
    expect(first).toMatchObject({ completed: 1, complete: false, passed: 1 });
    expect(agentRuns).toBe(1);
    const second = await runSuite({ manifestPath, outputDir, model: "test", upstreamRpcUrl: upstream.url,
      hardfork: "cancun", agent, resume: true });
    expect(second).toMatchObject({ completed: 2, complete: true, passed: 2 });
    expect(second.runId).toBe(first.runId);
    expect(agentRuns).toBe(2);
  });

  it("rejects duplicate categories before creating a paid run directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-gym-categories-"));
    tempDirs.push(directory);
    for (const id of ["one", "two"]) {
      await writeFile(join(directory, `${id}.json`), JSON.stringify({
        id, category: "native-transfer", name: id, objective: "Transfer ETH",
        environment: { chain: "ethereum", blockNumber: 1 },
        wallet: { balances: { ETH: "1" } }, tools: ["intentTransfer"],
        limits: { maxSteps: 2, maxTransactions: 1, maxReverts: 0, timeoutMs: 30_000 },
        graders: [{ type: "balance", asset: "ETH", account: RECIPIENT,
          operator: "gte", value: "0.1" }],
      }));
    }
    const manifestPath = join(directory, "suite.json");
    await writeFile(manifestPath, JSON.stringify({ id: "unique-categories", expectedTasks: 2,
      requireUniqueCategories: true, tasks: ["one.json", "two.json"] }));
    await expect(runSuite({ manifestPath, outputDir: join(directory, "output"),
      model: "test", upstreamRpcUrl: upstream.url,
      agent: { async run() { throw new Error("Should not start"); } },
    })).rejects.toThrow(/Duplicate suite task category native-transfer/);
    await expect(readFile(join(directory, "output", "run.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks transactions at the configured limit", async () => {
    const task = {
      id: "zero-transactions",
      name: "Zero transactions",
      objective: `Send 0.25 ETH to ${RECIPIENT}.`,
      environment: { chain: "ethereum", blockNumber: 1 },
      wallet: { balances: { ETH: "2" } },
      tools: ["intentTransfer"],
      limits: { maxSteps: 2, maxTransactions: 0, maxReverts: 0, timeoutMs: 30_000 },
      graders: [{ type: "balance", asset: "ETH", account: RECIPIENT, operator: "gte", value: "0.25" }],
    };
    const agent: AgentAdapter = {
      async run(context) {
        await context.execute("intentTransfer", {
          token: zeroAddress, amount: "0.25", to: RECIPIENT, chainId: 1,
        });
        return { completed: true };
      },
    };
    const run = await runEvaluation(task as any, agent, {
      model: "programmatic-test-agent",
      upstreamRpcUrl: upstream.url,
      hardfork: "cancun",
    });
    expect(run.result.success).toBe(false);
    expect(run.result.termination).toMatchObject({
      reason: "MAX_TRANSACTIONS", limit: 0, actual: 1,
    });
    expect(run.result.metrics.transactions).toBe(0);
    expect(run.trace.finalState?.walletNativeBalance).toBe("2000000000000000000");
  });

  it("grades a read-only agent's reported answer independently of transactions", async () => {
    const task = {
      id: "answer-read", category: "contract-read", name: "Answer a read",
      objective: "Report the contract answer.",
      environment: { chain: "ethereum", blockNumber: 1 },
      wallet: { balances: { ETH: "1" } }, tools: ["getBalance"],
      limits: { maxSteps: 1, maxTransactions: 0, maxReverts: 0, timeoutMs: 30_000 },
      graders: [{ type: "outputContains", value: "424242" }],
    };
    const passing = await runEvaluation(task as any, { async run() {
      return { completed: true, output: "The answer is 424242." };
    } }, { model: "programmatic", upstreamRpcUrl: upstream.url, hardfork: "cancun" });
    expect(passing.result).toMatchObject({ success: true, correctness: { passed: true } });
    expect(passing.result.metrics.transactions).toBe(0);
    const failing = await runEvaluation(task as any, { async run() {
      return { completed: true, output: "I do not know." };
    } }, { model: "programmatic", upstreamRpcUrl: upstream.url, hardfork: "cancun" });
    expect(failing.result).toMatchObject({ success: false, correctness: { passed: false } });
  });

});
