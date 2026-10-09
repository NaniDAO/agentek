import {
  createPublicClient,
  erc20Abi,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import type { MultiChainForkEnvironment } from "../environment/MultiChainForkEnvironment.js";
import { rpcRequest } from "../environment/rpc.js";
import type { TokenProvisioningConfig } from "../environment/types.js";
import { WalletProvisioner } from "../environment/wallet.js";

export const v3FundsDepositedEvent = parseAbiItem(
  "event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint32 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)",
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface AcrossChainSimulationConfig {
  chainId: number;
  spokePool: Address;
  fromBlock?: bigint;
  /** Optional known token storage metadata, keyed by lowercase token address. */
  assets?: Record<string, Omit<TokenProvisioningConfig, "address">>;
}

export interface AcrossRelayerAdapterOptions {
  environment: MultiChainForkEnvironment;
  chains: AcrossChainSimulationConfig[];
  /** Set to zero to disable polling and call flush() explicitly. */
  pollIntervalMs?: number;
}

export type AcrossRelayStatus =
  | "settled"
  | "expired"
  | "unsupported"
  | "failed";

export interface AcrossRelayTrace {
  originChainId: number;
  destinationChainId: number;
  depositId: number;
  transactionHash?: Hex;
  logIndex?: number;
  depositor: Address;
  recipient: Address;
  inputToken: Address;
  outputToken: Address;
  inputAmount: string;
  outputAmount: string;
  status: AcrossRelayStatus;
  settlement?: "anvil_state_override";
  error?: string;
}

/**
 * Deterministic Across V3 fast-fill simulator.
 *
 * It observes genuine V3FundsDeposited logs on origin forks and applies the
 * recipient-side token outcome on the configured destination fork. It does
 * not simulate Across repayment bundles, relayer economics, or message calls.
 */
export class AcrossRelayerAdapter {
  private readonly environment: MultiChainForkEnvironment;
  private readonly configs = new Map<number, AcrossChainSimulationConfig>();
  // Avoid expanding viem's complete generic client type into the public DTS.
  private readonly clients = new Map<number, any>();
  private readonly nextBlocks = new Map<number, bigint>();
  private readonly processed = new Set<string>();
  private readonly traces: AcrossRelayTrace[] = [];
  private readonly pollIntervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private activeFlush?: Promise<void>;
  private pollingError?: Error;

  constructor(options: AcrossRelayerAdapterOptions) {
    this.environment = options.environment;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    if (options.chains.length < 2) {
      throw new Error("Across simulation requires at least two chain configurations");
    }
    for (const config of options.chains) {
      if (this.configs.has(config.chainId)) {
        throw new Error(`Duplicate Across chain configuration ${config.chainId}`);
      }
      this.configs.set(config.chainId, config);
    }
  }

  async start(): Promise<void> {
    if (this.timer || this.clients.size > 0) {
      throw new Error("Across relayer adapter is already started");
    }
    for (const [chainId, config] of this.configs) {
      const client = createPublicClient({
        cacheTime: 0,
        chain: {
          id: chainId,
          name: `Gym chain ${chainId}`,
          nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [this.environment.getRpcUrl(chainId)] } },
        },
        transport: http(this.environment.getRpcUrl(chainId), { retryCount: 0 }),
      });
      this.clients.set(chainId, client);
      this.nextBlocks.set(
        chainId,
        config.fromBlock ?? ((await client.getBlockNumber()) + 1n),
      );
    }

    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => {
        void this.flush().catch((error) => {
          this.pollingError = error instanceof Error ? error : new Error(String(error));
        });
      }, this.pollIntervalMs);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeFlush;
    this.clients.clear();
    this.nextBlocks.clear();
  }

  async flush(): Promise<void> {
    if (this.clients.size === 0) throw new Error("Across relayer adapter is not started");
    if (this.activeFlush) return this.activeFlush;
    this.activeFlush = this.flushOnce().finally(() => {
      this.activeFlush = undefined;
    });
    return this.activeFlush;
  }

  getTraces(): AcrossRelayTrace[] {
    return this.traces.map((trace) => ({ ...trace }));
  }

  getPollingError(): Error | undefined {
    return this.pollingError;
  }

  private async flushOnce(): Promise<void> {
    for (const [originChainId, config] of this.configs) {
      const client = this.clients.get(originChainId)!;
      const fromBlock = this.nextBlocks.get(originChainId)!;
      const toBlock = await client.getBlockNumber();
      if (fromBlock > toBlock) continue;

      const logs = await client.getLogs({
        address: config.spokePool,
        event: v3FundsDepositedEvent,
        fromBlock,
        toBlock,
        strict: true,
      });
      for (const log of logs) await this.processDeposit(originChainId, log);
      this.nextBlocks.set(originChainId, toBlock + 1n);
    }
  }

  private async processDeposit(
    originChainId: number,
    log: {
      args: Record<string, unknown>;
      transactionHash: Hex | null;
      logIndex: number | null;
    },
  ): Promise<void> {
    const args = log.args as {
      inputToken: Address;
      outputToken: Address;
      inputAmount: bigint;
      outputAmount: bigint;
      destinationChainId: bigint;
      depositId: number;
      fillDeadline: number;
      depositor: Address;
      recipient: Address;
      message: Hex;
    };
    const destinationChainId = Number(args.destinationChainId);
    const key = `${originChainId}:${args.depositId}`;
    if (this.processed.has(key)) return;

    const base: Omit<AcrossRelayTrace, "status"> = {
      originChainId,
      destinationChainId,
      depositId: args.depositId,
      transactionHash: log.transactionHash ?? undefined,
      logIndex: log.logIndex ?? undefined,
      depositor: args.depositor,
      recipient: args.recipient,
      inputToken: args.inputToken,
      outputToken: args.outputToken,
      inputAmount: args.inputAmount.toString(),
      outputAmount: args.outputAmount.toString(),
    };

    try {
      const destinationConfig = this.configs.get(destinationChainId);
      const destinationClient = this.clients.get(destinationChainId);
      if (!destinationConfig || !destinationClient) {
        throw new Error(`Destination chain ${destinationChainId} is not configured`);
      }
      const destinationBlock = await destinationClient.getBlock();
      if (destinationBlock.timestamp > BigInt(args.fillDeadline)) {
        this.traces.push({ ...base, status: "expired" });
        this.processed.add(key);
        return;
      }
      if (args.outputToken.toLowerCase() === ZERO_ADDRESS) {
        this.traces.push({
          ...base,
          status: "unsupported",
          error: "Zero-address output tokens require an explicit route mapping",
        });
        this.processed.add(key);
        return;
      }
      if (args.message !== "0x") {
        this.traces.push({
          ...base,
          status: "unsupported",
          error: "Across message execution is not simulated",
        });
        this.processed.add(key);
        return;
      }

      const configuredAsset = destinationConfig.assets?.[args.outputToken.toLowerCase()];
      const decimals = configuredAsset?.decimals ?? Number(
        await destinationClient.readContract({
          address: args.outputToken,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      );
      const asset: TokenProvisioningConfig = {
        address: args.outputToken,
        decimals,
        balanceSlot: configuredAsset?.balanceSlot,
      };
      const rpcUrl = this.environment.getRpcUrl(destinationChainId);
      const checkpoint = await rpcRequest<string>(rpcUrl, "evm_snapshot");
      try {
        const provisioner = new WalletProvisioner(
          rpcUrl,
          args.recipient,
          destinationChainId,
        );
        const current = await provisioner.getTokenBalance(args.outputToken);
        await provisioner.setRawTokenBalance(asset, current + args.outputAmount);
      } catch (error) {
        await rpcRequest<boolean>(rpcUrl, "evm_revert", [checkpoint]);
        throw error;
      }

      this.traces.push({
        ...base,
        status: "settled",
        settlement: "anvil_state_override",
      });
      this.processed.add(key);
    } catch (error) {
      this.traces.push({
        ...base,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      this.processed.add(key);
    }
  }
}
