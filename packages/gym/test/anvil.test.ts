import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, erc20Abi, http, parseEther, type Address } from "viem";
import { mainnet } from "viem/chains";
import { AnvilForkEnvironment } from "../src/environment/AnvilForkEnvironment.js";
import { rpcRequest } from "../src/environment/rpc.js";

const hasAnvil = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;
const TOKEN = "0x1000000000000000000000000000000000000001" as Address;
// balanceOf(address) for a conventional mapping(address => uint256) at slot 3.
const BALANCE_OF_RUNTIME =
  "0x600435600052600360205260406000205460005260206000f3";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No test port available"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
    server.once("error", reject);
  });
}

async function waitForRpc(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await rpcRequest(url, "eth_chainId");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Test Anvil did not start");
}

async function stopProcess(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe.runIf(hasAnvil)("AnvilForkEnvironment", () => {
  let upstream: ChildProcess;
  let upstreamUrl: string;
  let forkBlock: bigint;
  let environment: AnvilForkEnvironment | undefined;

  beforeAll(async () => {
    const port = await freePort();
    upstreamUrl = `http://127.0.0.1:${port}`;
    upstream = spawn(
      "anvil",
      ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--silent"],
      { stdio: "ignore" },
    );
    await waitForRpc(upstreamUrl);
    await rpcRequest(upstreamUrl, "anvil_setCode", [TOKEN, BALANCE_OF_RUNTIME]);
    await rpcRequest(upstreamUrl, "anvil_mine", ["0x1"]);
    forkBlock = BigInt(await rpcRequest<string>(upstreamUrl, "eth_blockNumber"));
  });

  afterEach(async () => {
    await environment?.stop();
    environment = undefined;
  });

  afterAll(async () => {
    await stopProcess(upstream);
  });

  async function startEnvironment(): Promise<AnvilForkEnvironment> {
    environment = new AnvilForkEnvironment({
      chain: "ethereum",
      upstreamRpcUrl: upstreamUrl,
      blockNumber: forkBlock,
    });
    await environment.start();
    return environment;
  }

  it("starts at the pinned block and supports snapshot, mutation, revert, and reset", async () => {
    const env = await startEnvironment();
    const initial = await env.inspect();
    expect(initial.chainId).toBe(1);
    expect(initial.blockNumber).toBe(forkBlock);

    const snapshot = await env.snapshot();
    await rpcRequest(env.getRpcUrl(1), "anvil_setBalance", [
      initial.walletAddress,
      "0x1",
    ]);
    expect((await env.inspect()).walletNativeBalance).toBe(1n);
    await env.revert(snapshot);
    expect((await env.inspect()).walletNativeBalance).toBe(initial.walletNativeBalance);
  });

  it("provisions deterministic native and ERC-20 balances and resets to them", async () => {
    const env = await startEnvironment();
    await env.provisionWallet({
      balances: { ETH: "10", TEST: "123.45" },
      assets: { TEST: { address: TOKEN, decimals: 2 } },
    });

    const state = await env.inspect();
    expect(state.walletNativeBalance).toBe(parseEther("10"));
    const client = createPublicClient({ chain: mainnet, transport: http(env.getRpcUrl(1)) });
    expect(
      await client.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [state.walletAddress],
      }),
    ).toBe(12_345n);

    await rpcRequest(env.getRpcUrl(1), "anvil_setBalance", [state.walletAddress, "0x0"]);
    await env.reset();
    expect((await env.inspect()).walletNativeBalance).toBe(parseEther("10"));
  });

  it("shuts down its RPC process", async () => {
    const env = await startEnvironment();
    const url = env.getRpcUrl(1);
    await env.stop();
    environment = undefined;
    await expect(rpcRequest(url, "eth_chainId")).rejects.toThrow();
  });
});
