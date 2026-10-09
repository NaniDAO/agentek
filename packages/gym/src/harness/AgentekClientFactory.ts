import {
  contractTools,
  erc20Tools,
  rpcTools,
  swapTools,
  transferTools,
} from "@agentek/tools";
import {
  AgentekClient,
  type AgentekClientConfig,
  type BaseTool,
  type Op,
} from "@agentek/tools/client";
import { http, type Chain } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";
import { AnvilForkEnvironment } from "../environment/AnvilForkEnvironment.js";
import { MultiChainForkEnvironment } from "../environment/MultiChainForkEnvironment.js";
import { rpcRequest } from "../environment/rpc.js";

export const MVP_AGENTEK_TOOL_NAMES = [
  "getBalance",
  "getBalanceOf",
  "getAllowance",
  "readContract",
  "intentTransfer",
  "intentApprove",
  "intent0xSwap",
  "intentWriteContract",
] as const;

export type MvpAgentekToolName = (typeof MVP_AGENTEK_TOOL_NAMES)[number];

const MVP_TOOL_NAME_SET = new Set<string>(MVP_AGENTEK_TOOL_NAMES);

export interface CreateGymAgentekClientOptions {
  environment: AnvilForkEnvironment | MultiChainForkEnvironment;
  /** Exact Agentek tool names to expose. No other client tools are registered. */
  tools: readonly string[];
  /** Required only when `intent0xSwap` is selected. */
  zeroxApiKey?: string;
  /** Runner-owned observation of the local Agentek JSON-RPC transport. */
  rpcObserver?: GymRpcObserver;
}

export interface GymRpcObserver {
  beforeRequest?(method: string, params: unknown[], chainId?: number): void | Promise<void>;
  afterResponse?(method: string, result: unknown, chainId?: number): void | Promise<void>;
}

export class GymToolSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GymToolSelectionError";
  }
}

function toolMap(tools: BaseTool[]): Map<string, BaseTool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

/**
 * Resolve only the normal Agentek tools approved for the MVP. Keeping this
 * selection separate from client construction makes accidental tool leakage
 * directly unit-testable.
 */
export function selectMvpAgentekTools(
  requestedNames: readonly string[],
  options: { zeroxApiKey?: string } = {},
): BaseTool[] {
  if (requestedNames.length === 0) {
    throw new GymToolSelectionError("At least one Agentek tool must be selected");
  }

  const duplicate = requestedNames.find(
    (name, index) => requestedNames.indexOf(name) !== index,
  );
  if (duplicate) {
    throw new GymToolSelectionError(`Duplicate Agentek tool: ${duplicate}`);
  }

  const unsupported = requestedNames.filter((name) => !MVP_TOOL_NAME_SET.has(name));
  if (unsupported.length > 0) {
    throw new GymToolSelectionError(
      `Unsupported MVP Agentek tool${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}`,
    );
  }

  const available = toolMap([
    ...rpcTools(),
    ...erc20Tools(),
    ...contractTools(),
    ...transferTools(),
  ]);

  if (requestedNames.includes("intent0xSwap")) {
    const zeroxApiKey = options.zeroxApiKey?.trim();
    if (!zeroxApiKey) {
      throw new GymToolSelectionError(
        "intent0xSwap requires zeroxApiKey in Gym process configuration",
      );
    }
    for (const tool of swapTools({ zeroxApiKey })) available.set(tool.name, tool);
  }

  return requestedNames.map((name) => {
    const tool = available.get(name);
    if (!tool) {
      throw new GymToolSelectionError(
        `Agentek tool ${name} is approved but unavailable in this configuration`,
      );
    }
    return tool;
  });
}

function assertLoopbackRpcUrl(rpcUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("Gym RPC URL is invalid");
  }
  const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (
    parsed.protocol !== "http:" ||
    !isLoopback ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("Refusing to construct Agentek outside a loopback Gym RPC");
  }
}

async function assertGymControlledRpc(
  environment: AnvilForkEnvironment | MultiChainForkEnvironment,
  rpcUrl: string,
  expectedChainId: number,
): Promise<void> {
  if (!(environment instanceof AnvilForkEnvironment) &&
      !(environment instanceof MultiChainForkEnvironment)) {
    throw new Error("Refusing to construct Agentek for a non-Gym environment");
  }
  assertLoopbackRpcUrl(rpcUrl);

  const [chainIdHex, clientVersion] = await Promise.all([
    rpcRequest<string>(rpcUrl, "eth_chainId"),
    rpcRequest<string>(rpcUrl, "web3_clientVersion"),
  ]);
  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== expectedChainId) {
    throw new Error(`Gym Agentek harness expected chain ${expectedChainId}, received ${chainId}`);
  }
  if (!clientVersion.toLowerCase().startsWith("anvil/")) {
    throw new Error(
      `Refusing to construct Agentek for non-Anvil RPC client ${clientVersion}`,
    );
  }
}

class GuardedGymAgentekClient extends AgentekClient {
  constructor(
    config: AgentekClientConfig,
    private readonly environment: AnvilForkEnvironment | MultiChainForkEnvironment,
    private readonly rpcUrls: Map<number, string>,
  ) {
    super(config);
  }

  override async executeOps(ops: Op[], chainId: number): Promise<string> {
    const rpcUrl = this.rpcUrls.get(chainId);
    if (!rpcUrl) throw new Error(`Gym Agentek harness cannot transact on chain ${chainId}`);
    const currentRpcUrl = this.environment.getRpcUrl(chainId);
    if (currentRpcUrl !== rpcUrl) {
      throw new Error("Gym RPC changed after Agentek client construction");
    }
    await assertGymControlledRpc(this.environment, currentRpcUrl, chainId);
    return super.executeOps(ops, chainId);
  }
}

/** Construct a normal signer-backed Agentek client connected only to the fork. */
export async function createGymAgentekClient(
  options: CreateGymAgentekClientOptions,
): Promise<AgentekClient> {
  const chainRegistry = new Map<number, Chain>([
    [mainnet.id, mainnet], [base.id, base], [arbitrum.id, arbitrum],
    [optimism.id, optimism], [polygon.id, polygon],
  ]);
  const chainIds = options.environment instanceof MultiChainForkEnvironment
    ? options.environment.getChainIds()
    : [mainnet.id];
  const chains = chainIds.map((id) => {
    const chain = chainRegistry.get(id);
    if (!chain) throw new Error(`Gym chain ${id} is not supported by Agentek`);
    return chain;
  });
  const rpcUrls = new Map(chainIds.map((id) => [id, options.environment.getRpcUrl(id)]));
  await Promise.all(chainIds.map((id) =>
    assertGymControlledRpc(options.environment, rpcUrls.get(id)!, id)));
  const tools = selectMvpAgentekTools(options.tools, {
    zeroxApiKey: options.zeroxApiKey,
  });

  const observer = options.rpcObserver;

  const transports = chains.map((chain) => {
    const requestMethods = new Map<number, string>();
    return http(rpcUrls.get(chain.id)!, {
      retryCount: 0,
      onFetchRequest: observer ? async (_request, init) => {
        const body = JSON.parse(String(init.body)) as {
          id: number;
          method: string;
          params?: unknown[];
        };
        await observer.beforeRequest?.(body.method, body.params ?? [], chain.id);
        requestMethods.set(body.id, body.method);
      } : undefined,
      onFetchResponse: observer ? async (response) => {
        const body = await response.clone().json() as { id?: number; result?: unknown };
        if (body.id === undefined) return;
        const method = requestMethods.get(body.id);
        requestMethods.delete(body.id);
        if (method && "result" in body) {
          await observer.afterResponse?.(method, body.result, chain.id);
        }
      } : undefined,
    });
  });

  return new GuardedGymAgentekClient(
    {
      accountOrAddress: options.environment.getWalletAccount(),
      chains,
      transports,
      tools,
    },
    options.environment,
    rpcUrls,
  );
}
