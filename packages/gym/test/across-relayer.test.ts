import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  padHex,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  AcrossRelayerAdapter,
  v3FundsDepositedEvent,
} from "../src/adapters/AcrossRelayerAdapter.js";
import { MultiChainForkEnvironment } from "../src/environment/MultiChainForkEnvironment.js";
import { rpcRequest } from "../src/environment/rpc.js";
import { runEvaluation, type AgentAdapter } from "../src/runner/runEvaluation.js";

const hasAnvil = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;
const ORIGIN_SPOKE = "0x2000000000000000000000000000000000000001" as Address;
const DESTINATION_SPOKE = "0x2000000000000000000000000000000000000002" as Address;
const INPUT_TOKEN = "0x3000000000000000000000000000000000000001" as Address;
const OUTPUT_TOKEN = "0x3000000000000000000000000000000000000002" as Address;
const RECIPIENT = "0x4000000000000000000000000000000000000001" as Address;
const DEPOSITOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const BALANCE_OF_RUNTIME = "0x600435600052600360205260406000205460005260206000f3";

const hexWord = (value: bigint | Address): string =>
  typeof value === "bigint"
    ? toHex(value, { size: 32 }).slice(2)
    : padHex(value, { size: 32 }).slice(2);

function makeDepositEmitterRuntime(): Hex {
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint32" },
      { type: "uint32" },
      { type: "uint32" },
      { type: "address" },
      { type: "address" },
      { type: "bytes" },
    ],
    [INPUT_TOKEN, OUTPUT_TOKEN, 1_000_000n, 990_000n, 1, 4_294_967_295, 0, RECIPIENT, DEPOSITOR, "0x"],
  ).slice(2);
  const dataLength = data.length / 2;
  const topic0 = keccak256(stringToHex(v3FundsDepositedEvent.name + "(address,address,uint256,uint256,uint256,uint32,uint32,uint32,uint32,address,address,address,bytes)"));
  const runtimeBytesBeforeData = 148;
  const push2 = (value: number) => value.toString(16).padStart(4, "0");
  const code = [
    `61${push2(dataLength)}61${push2(runtimeBytesBeforeData)}600039`,
    `7f${hexWord(DEPOSITOR)}`,
    `7f${hexWord(7n)}`,
    `7f${hexWord(8453n)}`,
    `7f${topic0.slice(2)}`,
    `61${push2(dataLength)}6000a400`,
    data,
  ].join("");
  return `0x${code}` as Hex;
}

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

async function launchUpstream(chainId: number): Promise<{ child: ChildProcess; url: string }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await rpcRequest(url, "eth_chainId");
      return { child, url };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Upstream ${chainId} did not start`);
}

async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe.runIf(hasAnvil)("AcrossRelayerAdapter", () => {
  let ethereumUpstream: Awaited<ReturnType<typeof launchUpstream>>;
  let baseUpstream: Awaited<ReturnType<typeof launchUpstream>>;
  let environment: MultiChainForkEnvironment | undefined;
  let adapter: AcrossRelayerAdapter | undefined;

  beforeAll(async () => {
    [ethereumUpstream, baseUpstream] = await Promise.all([
      launchUpstream(1),
      launchUpstream(8453),
    ]);
    await rpcRequest(ethereumUpstream.url, "anvil_setCode", [ORIGIN_SPOKE, makeDepositEmitterRuntime()]);
    await rpcRequest(baseUpstream.url, "anvil_setCode", [OUTPUT_TOKEN, BALANCE_OF_RUNTIME]);
    await Promise.all([
      rpcRequest(ethereumUpstream.url, "anvil_mine", ["0x1"]),
      rpcRequest(baseUpstream.url, "anvil_mine", ["0x1"]),
    ]);
  });

  afterEach(async () => {
    await adapter?.stop();
    await environment?.stop();
    adapter = undefined;
    environment = undefined;
  });

  afterAll(async () => {
    await Promise.all([stop(ethereumUpstream?.child), stop(baseUpstream?.child)]);
  });

  it("observes a V3 deposit and settles the exact output once on the destination fork", async () => {
    const ethereumBlock = BigInt(await rpcRequest<string>(ethereumUpstream.url, "eth_blockNumber"));
    const baseBlock = BigInt(await rpcRequest<string>(baseUpstream.url, "eth_blockNumber"));
    environment = new MultiChainForkEnvironment({
      chains: [
        { chain: "ethereum", upstreamRpcUrl: ethereumUpstream.url, blockNumber: ethereumBlock, hardfork: "cancun" },
        { chain: "base", upstreamRpcUrl: baseUpstream.url, blockNumber: baseBlock, hardfork: "cancun" },
      ],
    });
    await environment.start();

    adapter = new AcrossRelayerAdapter({
      environment,
      pollIntervalMs: 0,
      chains: [
        { chainId: 1, spokePool: ORIGIN_SPOKE },
        {
          chainId: 8453,
          spokePool: DESTINATION_SPOKE,
          assets: { [OUTPUT_TOKEN.toLowerCase()]: { decimals: 6, balanceSlot: 3 } },
        },
      ],
    });
    await adapter.start();

    const depositHash = await rpcRequest<string>(environment.getRpcUrl(1), "eth_sendTransaction", [{
      from: DEPOSITOR,
      to: ORIGIN_SPOKE,
      data: "0x",
      gas: "0x100000",
      gasPrice: "0x3b9aca00",
      type: "0x0",
    }]);
    await rpcRequest(environment.getRpcUrl(1), "evm_mine");
    const receipt = await rpcRequest<any>(environment.getRpcUrl(1), "eth_getTransactionReceipt", [depositHash]);
    expect(receipt?.status).toBe("0x1");
    expect(receipt?.logs).toHaveLength(1);
    await adapter.flush();

    const destinationClient = createPublicClient({
      chain: {
        id: 8453,
        name: "Base gym",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [environment.getRpcUrl(8453)] } },
      },
      transport: http(environment.getRpcUrl(8453)),
    });
    const balance = await destinationClient.readContract({
      address: OUTPUT_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [RECIPIENT],
    });
    expect(balance).toBe(990_000n);
    expect(adapter.getTraces()).toMatchObject([
      { originChainId: 1, destinationChainId: 8453, depositId: 7, status: "settled" },
    ]);

    await adapter.flush();
    expect(adapter.getTraces()).toHaveLength(1);
    expect(await destinationClient.readContract({
      address: OUTPUT_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [RECIPIENT],
    })).toBe(990_000n);
  });

  it("runs a declarative cross-chain task through Agentek, Across simulation, safety, and grading", async () => {
    const ethereumBlock = Number(BigInt(await rpcRequest<string>(ethereumUpstream.url, "eth_blockNumber")));
    const baseBlock = Number(BigInt(await rpcRequest<string>(baseUpstream.url, "eth_blockNumber")));
    const agent: AgentAdapter = {
      async run(context) {
        await context.execute("intentWriteContract", {
          address: ORIGIN_SPOKE,
          functionName: "trigger",
          abi: [{ type: "function", name: "trigger", inputs: [], outputs: [], stateMutability: "nonpayable" }],
          chainId: 1,
        });
        return { completed: true };
      },
    };
    const run = await runEvaluation({
      id: "bridge-smoke",
      name: "Cross-chain settlement smoke",
      objective: "Trigger the origin deposit and receive the destination token.",
      environment: {
        chains: [
          { chain: "ethereum", blockNumber: ethereumBlock },
          { chain: "base", blockNumber: baseBlock },
        ],
        across: { chains: [
          { chain: "ethereum", spokePool: ORIGIN_SPOKE },
          { chain: "base", spokePool: DESTINATION_SPOKE,
            assets: { [OUTPUT_TOKEN.toLowerCase()]: { decimals: 6, balanceSlot: 3 } } },
        ] },
      },
      wallet: { chains: {
        ethereum: { balances: { ETH: "2" } },
        base: { balances: { ETH: "1" } },
      } },
      tools: ["intentWriteContract", "getBalance"],
      limits: { maxSteps: 3, maxTransactions: 1, maxReverts: 0, timeoutMs: 30_000 },
      graders: [
        { type: "acrossSettlement", originChain: "ethereum", destinationChain: "base",
          recipient: RECIPIENT, outputToken: OUTPUT_TOKEN },
        { type: "balance", chain: "base", asset: OUTPUT_TOKEN, account: RECIPIENT,
          operator: "gte", value: "0.99" },
      ],
      safety: {
        allowedTransactionTargets: { ethereum: [ORIGIN_SPOKE] },
        maxReverts: 0,
        balanceFloors: [{ type: "balance", chain: "base", asset: "ETH", account: "agent",
          operator: "gte", value: "1" }],
      },
    }, agent, {
      model: "programmatic-agent",
      upstreamRpcUrl: ethereumUpstream.url,
      upstreamRpcUrls: { ethereum: ethereumUpstream.url, base: baseUpstream.url },
      hardfork: "cancun",
    });
    expect(run.result.success).toBe(true);
    expect(run.result.correctness.passed).toBe(true);
    expect(run.result.safety.passed).toBe(true);
    expect(run.result.graders.every((grader) => grader.passed)).toBe(true);
    expect(run.trace.acrossRelays).toMatchObject([{ status: "settled" }]);
    expect(run.trace.transactions).toMatchObject([{ chainId: 1, status: "success" }]);
    expect(run.trace.initialStates).toHaveProperty("8453");
  });
});
