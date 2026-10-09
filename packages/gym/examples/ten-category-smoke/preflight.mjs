#!/usr/bin/env node
// Runs all ten tasks with a deterministic agent. No model provider or API key is used.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN, COUNTER, EXCHANGE, ORIGIN_SPOKE, SPENDER } from "./runtime.mjs";

const { loadTask, runSuite } = await import(
  process.env.AGENTEK_GYM_MODULE ?? new URL("../../dist/index.js", import.meta.url).href
);

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(root, "suite.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const tasks = await Promise.all(manifest.tasks.map((path) => loadTask(join(root, path))));
const byObjective = new Map(tasks.map((task) => [task.objective, task.id]));
const A = "0x6000000000000000000000000000000000000001";
const B = "0x6000000000000000000000000000000000000002";
const ETH = "0x0000000000000000000000000000000000000000";
const answerAbi = [{ type: "function", name: "answer", stateMutability: "view", inputs: [],
  outputs: [{ type: "uint256" }] }];
const incrementAbi = [{ type: "function", name: "increment", stateMutability: "nonpayable",
  inputs: [], outputs: [] }];
const swapAbi = [{ type: "function", name: "swap", stateMutability: "payable",
  inputs: [], outputs: [{ type: "bool" }] }];
const triggerAbi = [{ type: "function", name: "trigger", stateMutability: "nonpayable",
  inputs: [], outputs: [] }];

const agent = { async run(ctx) {
  const id = byObjective.get(ctx.objective);
  const execute = (name, args) => ctx.execute(name, args);
  const transfer = (token, amount, to) => execute("intentTransfer", { token, amount, to, chainId: 1 });
  let output = "done";
  switch (id) {
    case "read-contract": {
      const value = await execute("readContract", {
        address: COUNTER, functionName: "answer", abi: answerAbi, chainId: 1,
      });
      output = String(value);
      break;
    }
    case "native-payment": await transfer(ETH, "0.125", A); break;
    case "token-payment": await transfer(TOKEN, "100", B); break;
    case "grant-allowance":
      await execute("intentApprove", { token: TOKEN, spender: SPENDER, amount: "500", chainId: 1 });
      break;
    case "revoke-allowance":
      await execute("intentApprove", { token: TOKEN, spender: SPENDER, amount: "0", chainId: 1 });
      break;
    case "write-contract":
      await execute("intentWriteContract", { address: COUNTER, functionName: "increment",
        abi: incrementAbi, chainId: 1 });
      break;
    case "fixed-rate-swap":
      await execute("intentWriteContract", { address: EXCHANGE, functionName: "swap",
        abi: swapAbi, value: "100000000000000000", chainId: 1 });
      break;
    case "mixed-asset-settlement":
      await transfer(ETH, "0.1", A);
      await transfer(TOKEN, "50", B);
      break;
    case "authorized-recipient": await transfer(ETH, "0.2", A); break;
    case "across-bridge":
      await execute("intentWriteContract", { address: ORIGIN_SPOKE, functionName: "trigger",
        abi: triggerAbi, chainId: 1 });
      break;
    default: throw new Error(`No deterministic agent for ${id}`);
  }
  return { completed: true, output };
} };

const outputDir = join(await mkdtemp(join(tmpdir(), "agentek-ten-category-preflight-")), "run");
const report = await runSuite({
  manifestPath, outputDir,
  model: "deterministic-preflight",
  agent,
  upstreamRpcUrl: process.env.ETHEREUM_RPC_URL ?? "http://127.0.0.1:18545",
  upstreamRpcUrls: { base: process.env.BASE_RPC_URL ?? "http://127.0.0.1:18546" },
  hardfork: "cancun",
});
console.log(`Free deterministic preflight: ${report.passed}/${report.total} passed`);
for (const task of report.tasks) {
  console.log(`${task.success ? "PASS" : "FAIL"} ${task.category}: ${task.toolCalls} tool calls, ${task.transactions} transactions`);
}
console.log(`Report: ${join(outputDir, "report.json")}`);
if (report.passed !== report.total) process.exitCode = 1;
