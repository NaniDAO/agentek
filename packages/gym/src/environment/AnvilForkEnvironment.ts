import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { PrivateKeyAccount } from "viem";
import type {
  EnvironmentState,
  GymChainName,
  GymEnvironment,
  WalletProvisioningConfig,
} from "./types.js";
import { rpcRequest } from "./rpc.js";
import { createGymWallet, WalletProvisioner } from "./wallet.js";

export const GYM_CHAIN_IDS: Record<GymChainName, number> = {
  ethereum: 1,
  optimism: 10,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
};

export interface AnvilForkEnvironmentOptions {
  chain: GymChainName;
  upstreamRpcUrl: string;
  blockNumber: bigint;
  port?: number;
  anvilBinary?: string;
  startupTimeoutMs?: number;
  /** Optional fixed EVM hardfork, useful when forking synthetic test chains. */
  hardfork?: "shanghai" | "cancun" | "prague";
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an Anvil port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function validateOptions(options: AnvilForkEnvironmentOptions): void {
  if (!GYM_CHAIN_IDS[options.chain]) {
    throw new Error(`Unsupported gym chain: ${String(options.chain)}`);
  }
  if (options.blockNumber < 0n) {
    throw new Error("Anvil fork blockNumber must be non-negative");
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)) {
    throw new Error(`Invalid Anvil port: ${options.port}`);
  }
  const upstream = new URL(options.upstreamRpcUrl);
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("upstreamRpcUrl must use HTTP or HTTPS");
  }
}

function validateAnvilBinary(binary: string): void {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Anvil binary is unavailable or invalid: ${binary}. Install Foundry or set anvilBinary.`,
    );
  }
}

export class AnvilForkEnvironment implements GymEnvironment {
  private child?: ChildProcess;
  private rpcUrl?: string;
  private resetSnapshotId?: string;
  private parentExitHandler?: () => void;
  private readonly account: PrivateKeyAccount;
  private readonly chainId: number;

  constructor(private readonly options: AnvilForkEnvironmentOptions) {
    validateOptions(options);
    this.account = createGymWallet();
    this.chainId = GYM_CHAIN_IDS[options.chain];
  }

  async start(): Promise<void> {
    if (this.child) throw new Error("Anvil environment is already started");

    const binary = this.options.anvilBinary ?? (process.env.ANVIL_BINARY?.trim() || "anvil");
    validateAnvilBinary(binary);
    const port = this.options.port ?? (await reserveLoopbackPort());
    this.rpcUrl = `http://127.0.0.1:${port}`;

    const args = [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--chain-id",
        String(this.chainId),
        "--fork-url",
        this.options.upstreamRpcUrl,
        "--fork-block-number",
        this.options.blockNumber.toString(),
        "--silent",
      ];
    if (this.options.hardfork) args.push("--hardfork", this.options.hardfork);
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;

    let diagnostics = "";
    child.on("error", (error) => {
      diagnostics = (diagnostics + error.message).slice(-4_096);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString("utf8")).slice(-4_096);
    });
    this.parentExitHandler = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    };
    process.once("exit", this.parentExitHandler);
    child.once("exit", () => {
      if (this.parentExitHandler) {
        process.removeListener("exit", this.parentExitHandler);
        this.parentExitHandler = undefined;
      }
      if (this.child === child) {
        this.child = undefined;
        this.rpcUrl = undefined;
        this.resetSnapshotId = undefined;
      }
    });

    try {
      await this.waitUntilHealthy(child, () => diagnostics);
      this.resetSnapshotId = await this.snapshot();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  getRpcUrl(chainId: number): string {
    if (chainId !== this.chainId) {
      throw new Error(`Environment only provides chain ${this.chainId}`);
    }
    if (!this.rpcUrl || !this.child) {
      throw new Error("Anvil environment is not started");
    }
    return this.rpcUrl;
  }

  getWalletAccount(): PrivateKeyAccount {
    return this.account;
  }

  async provisionWallet(config: WalletProvisioningConfig): Promise<void> {
    const rpcUrl = this.requireRpcUrl();
    await new WalletProvisioner(rpcUrl, this.account, this.chainId).provision(config);
    // Reset now means "return to the task's provisioned initial state".
    this.resetSnapshotId = await this.snapshot();
  }

  async snapshot(): Promise<string> {
    return rpcRequest<string>(this.requireRpcUrl(), "evm_snapshot");
  }

  async revert(snapshotId: string): Promise<void> {
    const reverted = await rpcRequest<boolean>(this.requireRpcUrl(), "evm_revert", [
      snapshotId,
    ]);
    if (!reverted) throw new Error(`Anvil rejected snapshot ${snapshotId}`);
  }

  async reset(): Promise<void> {
    if (!this.resetSnapshotId) throw new Error("No reset snapshot is available");
    await this.revert(this.resetSnapshotId);
    this.resetSnapshotId = await this.snapshot();
  }

  async inspect(): Promise<EnvironmentState> {
    const rpcUrl = this.requireRpcUrl();
    const [chainId, blockNumber, nativeBalance] = await Promise.all([
      rpcRequest<string>(rpcUrl, "eth_chainId"),
      rpcRequest<string>(rpcUrl, "eth_blockNumber"),
      rpcRequest<string>(rpcUrl, "eth_getBalance", [this.account.address, "latest"]),
    ]);
    return {
      chainId: Number(BigInt(chainId)),
      blockNumber: BigInt(blockNumber),
      walletAddress: this.account.address,
      walletNativeBalance: BigInt(nativeBalance),
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.resetSnapshotId = undefined;
    this.rpcUrl = undefined;
    if (this.parentExitHandler) {
      process.removeListener("exit", this.parentExitHandler);
      this.parentExitHandler = undefined;
    }
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 2_000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private requireRpcUrl(): string {
    if (!this.rpcUrl || !this.child) throw new Error("Anvil environment is not started");
    return this.rpcUrl;
  }

  private async waitUntilHealthy(
    child: ChildProcess,
    getDiagnostics: () => string,
  ): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs ?? 20_000;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Anvil exited before becoming healthy${getDiagnostics() ? `: ${getDiagnostics().trim()}` : ""}`,
        );
      }
      try {
        const rpcUrl = this.requireRpcUrl();
        const [chainId, blockNumber] = await Promise.all([
          rpcRequest<string>(rpcUrl, "eth_chainId", [], AbortSignal.timeout(1_000)),
          rpcRequest<string>(rpcUrl, "eth_blockNumber", [], AbortSignal.timeout(1_000)),
        ]);
        if (Number(BigInt(chainId)) !== this.chainId) {
          throw new Error(`Anvil returned chain ID ${BigInt(chainId)}`);
        }
        if (BigInt(blockNumber) !== this.options.blockNumber) {
          throw new Error(
            `Anvil fork is at block ${BigInt(blockNumber)}, expected ${this.options.blockNumber}`,
          );
        }
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    throw new Error(
      `Anvil did not become healthy within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}
