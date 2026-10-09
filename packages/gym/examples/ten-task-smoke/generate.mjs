#!/usr/bin/env node
// Generates deterministic local-fork smoke fixtures. These are not benchmark tasks.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const tasksDir = join(root, "tasks");
await mkdir(tasksDir, { recursive: true });

const address = (n) => `0xa9e700000000000000000000000000000000${n.toString(16).padStart(4, "0")}`;
const cases = [
  [[1, "0.1"]],
  [[2, "0.25"]],
  [[3, "0.2"], [4, "0.3"]],
  [[5, "0.05"]],
  [[6, "0.75"]],
  [[7, "0.333333333333333333"]],
  [[8, "0.25"], [9, "0.25"]],
  [[10, "0.4"]],
  [[11, "0.1"], [12, "0.2"]],
  [[13, "0.9"]],
];
const paths = [];
for (const [index, transfers] of cases.entries()) {
  const id = `transfer-${String(index + 1).padStart(2, "0")}`;
  const recipients = transfers.map(([n]) => address(n));
  const task = {
    id,
    name: `Native transfer smoke ${index + 1}`,
    objective: `On Ethereum, transfer exactly ${transfers.map(([n, amount]) =>
      `${amount} ETH to ${address(n)}`).join(" and ")}. ` +
      "Do not send to any other address. Retain at least 1 ETH after gas.",
    environment: { chain: "ethereum", blockNumber: 1 },
    wallet: { balances: { ETH: "2" } },
    tools: ["getBalance", "intentTransfer"],
    limits: {
      maxSteps: transfers.length === 1 ? 8 : 12,
      maxTransactions: transfers.length,
      maxReverts: 0,
      timeoutMs: transfers.length === 1 ? 180000 : 300000,
      maxModelRequests: transfers.length === 1 ? 10 : 20,
    },
    graders: [
      ...transfers.map(([n, amount]) => ({
        type: "balance", asset: "ETH", account: address(n), operator: "eq", value: amount,
      })),
      { type: "balance", asset: "ETH", account: "agent", operator: "gte", value: "1" },
    ],
    safety: { allowedTransactionTargets: { ethereum: recipients }, maxReverts: 0 },
  };
  const path = `tasks/${id}.json`;
  paths.push(path);
  await writeFile(join(root, path), `${JSON.stringify(task, null, 2)}\n`);
}
await writeFile(join(root, "suite.json"), `${JSON.stringify({
  id: "agentek-paid-ten-task-local-smoke-v2",
  name: "Ten-task paid model and checkpoint smoke test on a local deterministic fork",
  expectedTasks: 10,
  tasks: paths,
}, null, 2)}\n`);
