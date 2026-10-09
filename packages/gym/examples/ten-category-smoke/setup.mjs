#!/usr/bin/env node
// Disposable local upstreams. Never point these fixtures at a real wallet or RPC.
import { spawn } from "node:child_process";
import { parseUnits, toHex } from "viem";
import {
  TOKEN, COUNTER, EXCHANGE, ORIGIN_SPOKE, OUTPUT_TOKEN,
  GYM_WALLET, SPENDER, tokenRuntime, counterRuntime, exchangeRuntime,
  bridgeEmitterRuntime, balanceSlotKey, allowanceSlotKey,
} from "./runtime.mjs";

const ethereumPort = Number(process.env.FIXTURE_ETHEREUM_PORT ?? 18545);
const basePort = Number(process.env.FIXTURE_BASE_PORT ?? 18546);
const children = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);

async function rpc(url, method, params = []) {
  const response = await fetch(url, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function launch(chainId, port) {
  const url = `http://127.0.0.1:${port}`;
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port),
    "--chain-id", String(chainId), "--hardfork", "cancun", "--silent"],
  { stdio: ["ignore", "inherit", "inherit"] });
  children.push(child);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Anvil chain ${chainId} exited during startup`);
    try {
      if (Number(BigInt(await rpc(url, "eth_chainId"))) === chainId) return url;
    } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Anvil chain ${chainId} did not become healthy`);
}

try {
  const [ethereum, base] = await Promise.all([launch(1, ethereumPort), launch(8453, basePort)]);
  await Promise.all([
    rpc(ethereum, "anvil_setCode", [TOKEN, tokenRuntime()]),
    rpc(ethereum, "anvil_setCode", [COUNTER, counterRuntime()]),
    rpc(ethereum, "anvil_setCode", [EXCHANGE, exchangeRuntime()]),
    rpc(ethereum, "anvil_setCode", [ORIGIN_SPOKE, bridgeEmitterRuntime()]),
    rpc(base, "anvil_setCode", [OUTPUT_TOKEN, tokenRuntime()]),
  ]);
  await Promise.all([
    rpc(ethereum, "anvil_setStorageAt", [TOKEN, balanceSlotKey(EXCHANGE),
      toHex(parseUnits("1000000", 6), { size: 32 })]),
    rpc(ethereum, "anvil_setStorageAt", [TOKEN, allowanceSlotKey(GYM_WALLET, SPENDER),
      toHex(parseUnits("1000", 6), { size: 32 })]),
    rpc(ethereum, "anvil_setStorageAt", [COUNTER, toHex(0, { size: 32 }),
      toHex(424242, { size: 32 })]),
  ]);
  await Promise.all([rpc(ethereum, "anvil_mine", ["0x1"]), rpc(base, "anvil_mine", ["0x1"])]);
  console.log(`ETHEREUM_RPC_URL=${ethereum}`);
  console.log(`BASE_RPC_URL=${base}`);
  console.log("Fixture fork block: 1 on both chains. Stop with Ctrl-C.");
  await new Promise((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
