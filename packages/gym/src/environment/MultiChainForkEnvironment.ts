import type { PrivateKeyAccount } from "viem";
import {
  AnvilForkEnvironment,
  GYM_CHAIN_IDS,
  type AnvilForkEnvironmentOptions,
} from "./AnvilForkEnvironment.js";
import type { EnvironmentState, WalletProvisioningConfig } from "./types.js";

export type MultiChainSnapshot = Record<number, string>;

export interface MultiChainForkEnvironmentOptions {
  chains: AnvilForkEnvironmentOptions[];
}

export class MultiChainForkEnvironment {
  private readonly environments = new Map<number, AnvilForkEnvironment>();

  constructor(options: MultiChainForkEnvironmentOptions) {
    if (options.chains.length < 2) {
      throw new Error("A multi-chain environment requires at least two forks");
    }
    for (const chain of options.chains) {
      const chainId = GYM_CHAIN_IDS[chain.chain];
      if (this.environments.has(chainId)) {
        throw new Error(`Duplicate fork configuration for chain ${chainId}`);
      }
      this.environments.set(chainId, new AnvilForkEnvironment(chain));
    }
  }

  getChainIds(): number[] {
    return [...this.environments.keys()];
  }

  getRpcUrl(chainId: number): string {
    return this.requireEnvironment(chainId).getRpcUrl(chainId);
  }

  getWalletAccount(): PrivateKeyAccount {
    return this.environments.values().next().value!.getWalletAccount();
  }

  async start(): Promise<void> {
    const outcomes = await Promise.allSettled(
      [...this.environments.values()].map((environment) => environment.start()),
    );
    const failure = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (failure) {
      await this.stop();
      throw failure.reason;
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled(
      [...this.environments.values()].map((environment) => environment.stop()),
    );
  }

  async reset(): Promise<void> {
    await Promise.all([...this.environments.values()].map((environment) => environment.reset()));
  }

  async snapshot(): Promise<MultiChainSnapshot> {
    const entries = await Promise.all(
      [...this.environments.entries()].map(async ([chainId, environment]) => [
        chainId,
        await environment.snapshot(),
      ] as const),
    );
    return Object.fromEntries(entries) as MultiChainSnapshot;
  }

  async revert(snapshot: MultiChainSnapshot): Promise<void> {
    for (const [chainId, environment] of this.environments) {
      const snapshotId = snapshot[chainId];
      if (!snapshotId) throw new Error(`Snapshot is missing chain ${chainId}`);
      await environment.revert(snapshotId);
    }
  }

  async inspect(): Promise<Record<number, EnvironmentState>> {
    const entries = await Promise.all(
      [...this.environments.entries()].map(async ([chainId, environment]) => [
        chainId,
        await environment.inspect(),
      ] as const),
    );
    return Object.fromEntries(entries) as Record<number, EnvironmentState>;
  }

  async provisionWallet(
    chainId: number,
    config: WalletProvisioningConfig,
  ): Promise<void> {
    await this.requireEnvironment(chainId).provisionWallet(config);
  }

  private requireEnvironment(chainId: number): AnvilForkEnvironment {
    const environment = this.environments.get(chainId);
    if (!environment) throw new Error(`No gym fork configured for chain ${chainId}`);
    return environment;
  }
}
