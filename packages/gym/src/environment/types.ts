import type { Address, PrivateKeyAccount } from "viem";

export interface EnvironmentState {
  chainId: number;
  blockNumber: bigint;
  walletAddress: Address;
  walletNativeBalance: bigint;
}

export interface GymEnvironment {
  start(): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
  getRpcUrl(chainId: number): string;
  snapshot(): Promise<string>;
  revert(snapshotId: string): Promise<void>;
  inspect(): Promise<EnvironmentState>;
  getWalletAccount(): PrivateKeyAccount;
}

export interface TokenProvisioningConfig {
  address: Address;
  decimals: number;
  /** Solidity mapping slot for balanceOf. Auto-discovered when omitted. */
  balanceSlot?: number;
}

export interface WalletProvisioningConfig {
  balances: Record<string, string>;
  assets?: Record<string, TokenProvisioningConfig>;
}

export type GymChainName =
  | "ethereum"
  | "optimism"
  | "arbitrum"
  | "base"
  | "polygon";
