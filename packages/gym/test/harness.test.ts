import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http, parseEther, zeroAddress, type Address } from "viem";
import { AnvilForkEnvironment } from "../src/environment/AnvilForkEnvironment.js";
import { rpcRequest } from "../src/environment/rpc.js";
import {
  createGymAgentekClient,
  GymToolSelectionError,
  selectMvpAgentekTools,
} from "../src/harness/AgentekClientFactory.js";

const hasAnvil = spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;
const RECIPIENT = "0x000000000000000000000000000000000000dEaD" as Address;

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

async function launchUpstream(): Promise<{ child: ChildProcess; url: string }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--silent"],
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
  throw new Error("Upstream Anvil did not start");
}

async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

describe("MVP Agentek tool selection", () => {
  it("returns only requested normal Agentek tools in request order", () => {
    const tools = selectMvpAgentekTools([
      "readContract",
      "getBalance",
      "intentTransfer",
    ]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "readContract",
      "getBalance",
      "intentTransfer",
    ]);
    expect(tools.some((tool) => tool.name === "intentWriteContract")).toBe(false);
  });

  it("fails closed for unsupported and duplicate tools", () => {
    expect(() => selectMvpAgentekTools(["nonAgentekBenchmarkWrite"])).toThrow(
      GymToolSelectionError,
    );
    expect(selectMvpAgentekTools(["intentWriteContract"]).map((tool) => tool.name))
      .toEqual(["intentWriteContract"]);
    expect(() => selectMvpAgentekTools(["getBalance", "getBalance"])).toThrow(
      /Duplicate Agentek tool/,
    );
  });

  it("requires process configuration before exposing the swap tool", () => {
    expect(() => selectMvpAgentekTools(["intent0xSwap"])).toThrow(/zeroxApiKey/);
    expect(
      selectMvpAgentekTools(["intent0xSwap"], { zeroxApiKey: "test-key" }).map(
        (tool) => tool.name,
      ),
    ).toEqual(["intent0xSwap"]);
  });

  it("rejects environments not owned by the Gym", async () => {
    const fakeEnvironment = {
      getRpcUrl: () => "https://ethereum.example.invalid",
    } as unknown as AnvilForkEnvironment;
    await expect(
      createGymAgentekClient({
        environment: fakeEnvironment,
        tools: ["getBalance"],
      }),
    ).rejects.toThrow(/non-Gym environment/);
  });
});

describe.runIf(hasAnvil)("Gym Agentek client", () => {
  let upstream: Awaited<ReturnType<typeof launchUpstream>>;
  let environment: AnvilForkEnvironment | undefined;

  beforeAll(async () => {
    upstream = await launchUpstream();
  });

  afterEach(async () => {
    await environment?.stop();
    environment = undefined;
  });

  afterAll(async () => {
    await stop(upstream?.child);
  });

  it("reads and transfers through an allowlisted Agentek client on the fork", async () => {
    const blockNumber = BigInt(
      await rpcRequest<string>(upstream.url, "eth_blockNumber"),
    );
    environment = new AnvilForkEnvironment({
      chain: "ethereum",
      upstreamRpcUrl: upstream.url,
      blockNumber,
      hardfork: "cancun",
    });
    await environment.start();
    await environment.provisionWallet({ balances: { ETH: "2" } });

    const client = await createGymAgentekClient({
      environment,
      tools: ["getBalance", "intentTransfer"],
    });
    expect([...client.getTools().keys()]).toEqual(["getBalance", "intentTransfer"]);
    expect(client.getTools().has("readContract")).toBe(false);

    const account = await client.getAddress();
    await expect(
      client.execute("getBalance", { address: account, chainId: 1 }),
    ).resolves.toBe(parseEther("2").toString());

    const result = await client.execute("intentTransfer", {
      token: zeroAddress,
      amount: "0.25",
      to: RECIPIENT,
      chainId: 1,
    });
    expect(result).toMatchObject({ chain: 1 });
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/i);

    const publicClient = createPublicClient({
      transport: http(environment.getRpcUrl(1), { retryCount: 0 }),
    });
    await expect(publicClient.getBalance({ address: RECIPIENT })).resolves.toBe(
      parseEther("0.25"),
    );
  });
});
