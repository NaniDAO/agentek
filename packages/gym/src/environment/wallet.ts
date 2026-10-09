import {
  createPublicClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type {
  TokenProvisioningConfig,
  WalletProvisioningConfig,
} from "./types.js";
import { rpcRequest } from "./rpc.js";

/**
 * Anvil's first documented development key. It is public and must never hold
 * real funds. Keeping it fixed makes every gym run use the same address.
 */
const GYM_TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

export const GYM_WALLET_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

export const ETHEREUM_MVP_ASSETS: Record<string, TokenProvisioningConfig> = {
  USDC: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
};

export function createGymWallet(): PrivateKeyAccount {
  return privateKeyToAccount(GYM_TEST_PRIVATE_KEY);
}

const mappingStorageKey = (owner: Address, slot: number): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [owner, BigInt(slot)],
    ),
  );

export class WalletProvisioner {
  private readonly client;
  private readonly address: Address;

  constructor(
    private readonly rpcUrl: string,
    accountOrAddress: PrivateKeyAccount | Address = createGymWallet(),
    private readonly chainId = 1,
  ) {
    this.address =
      typeof accountOrAddress === "string" ? accountOrAddress : accountOrAddress.address;
    this.client = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(rpcUrl, { retryCount: 0 }),
    });
  }

  async provision(config: WalletProvisioningConfig): Promise<void> {
    const checkpoint = await rpcRequest<string>(this.rpcUrl, "evm_snapshot");
    try {
      const assets = {
        ...(this.chainId === 1 ? ETHEREUM_MVP_ASSETS : {}),
        ...config.assets,
      };
      for (const [rawSymbol, rawAmount] of Object.entries(config.balances)) {
        const symbol = rawSymbol.toUpperCase();
        if (symbol === "ETH") {
          await this.setNativeBalance(rawAmount);
          continue;
        }

        const asset = assets[symbol];
        if (!asset) {
          throw new Error(
            `No Ethereum provisioning metadata for asset ${rawSymbol}`,
          );
        }
        await this.setTokenBalance(asset, rawAmount, rawSymbol);
      }

      await this.assertBalances(config, assets);
    } catch (error) {
      await rpcRequest<boolean>(this.rpcUrl, "evm_revert", [checkpoint]).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async getTokenBalance(token: Address): Promise<bigint> {
    return this.readTokenBalance(token);
  }

  async setRawTokenBalance(
    asset: TokenProvisioningConfig,
    amount: bigint,
  ): Promise<void> {
    if (amount < 0n) throw new Error("Token balance cannot be negative");
    const code = await this.client.getBytecode({ address: asset.address });
    if (!code || code === "0x") {
      throw new Error(`Cannot provision token ${asset.address}: contract has no code`);
    }
    const slot = asset.balanceSlot ?? (await this.discoverBalanceSlot(asset));
    await this.writeTokenBalance(asset.address, slot, amount);
    const actual = await this.readTokenBalance(asset.address);
    if (actual !== amount) {
      throw new Error(
        `Token provisioning assertion failed: expected ${amount}, got ${actual}`,
      );
    }
  }

  private async setNativeBalance(amount: string): Promise<void> {
    const value = parseUnits(amount, 18);
    await rpcRequest(this.rpcUrl, "anvil_setBalance", [
      this.address,
      toHex(value),
    ]);
  }

  private async setTokenBalance(
    asset: TokenProvisioningConfig,
    amount: string,
    symbol: string,
  ): Promise<void> {
    const code = await this.client.getBytecode({ address: asset.address });
    if (!code || code === "0x") {
      throw new Error(`Cannot provision ${symbol}: token contract has no code`);
    }

    const desired = parseUnits(amount, asset.decimals);
    const slot = asset.balanceSlot ?? (await this.discoverBalanceSlot(asset));
    await this.writeTokenBalance(asset.address, slot, desired);

    const actual = await this.readTokenBalance(asset.address);
    if (actual !== desired) {
      throw new Error(
        `Failed to provision ${symbol}: expected ${desired}, got ${actual}`,
      );
    }
  }

  private async discoverBalanceSlot(
    asset: TokenProvisioningConfig,
  ): Promise<number> {
    const current = await this.readTokenBalance(asset.address);
    const fixedProbe = 1_234_567_890_123n;
    const probe = current === fixedProbe ? current + 1n : fixedProbe;

    for (let slot = 0; slot < 128; slot += 1) {
      const checkpoint = await rpcRequest<string>(this.rpcUrl, "evm_snapshot");
      try {
        await this.writeTokenBalance(asset.address, slot, probe);
        if ((await this.readTokenBalance(asset.address)) === probe) return slot;
      } catch {
        // Non-standard tokens may reject reads for unrelated state mutations.
      } finally {
        await rpcRequest<boolean>(this.rpcUrl, "evm_revert", [checkpoint]);
      }
    }

    throw new Error(
      `Could not discover balance storage for token ${asset.address}; provide balanceSlot`,
    );
  }

  private async writeTokenBalance(
    token: Address,
    slot: number,
    amount: bigint,
  ): Promise<void> {
    await rpcRequest(this.rpcUrl, "anvil_setStorageAt", [
      token,
      mappingStorageKey(this.address, slot),
      toHex(amount, { size: 32 }),
    ]);
  }

  private async readTokenBalance(token: Address): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.address],
    });
  }

  private async assertBalances(
    config: WalletProvisioningConfig,
    assets: Record<string, TokenProvisioningConfig>,
  ): Promise<void> {
    for (const [rawSymbol, rawAmount] of Object.entries(config.balances)) {
      const symbol = rawSymbol.toUpperCase();
      if (symbol === "ETH") {
        const actual = await this.client.getBalance({ address: this.address });
        const expected = parseUnits(rawAmount, 18);
        if (actual !== expected) {
          throw new Error(
            `ETH provisioning assertion failed: expected ${expected}, got ${actual}`,
          );
        }
      } else {
        const asset = assets[symbol];
        const actual = await this.readTokenBalance(asset.address);
        const expected = parseUnits(rawAmount, asset.decimals);
        if (actual !== expected) {
          throw new Error(
            `${rawSymbol} provisioning assertion failed: expected ${expected}, got ${actual}`,
          );
        }
      }
    }
  }
}
