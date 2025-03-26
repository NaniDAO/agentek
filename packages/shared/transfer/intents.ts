import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  Hex,
  parseUnits,
  PublicClient,
} from "viem";
import { addressSchema } from "../utils.js";
import { resolveENSTool } from "../ens/tools.js";

const intentTransferChains = [mainnet, arbitrum, base, sepolia];
const intentTransferParameters = z.object({
  token: addressSchema.describe("The token address"),
  amount: z.string().describe("The amount to transfer"),
  to: z.string().describe("The recipient address or ENS name"),
  chainId: z.number().optional().describe("Optional specify chainId to use"),
});

export const ETH_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

const getTokenDecimals = async (
  publicClient: PublicClient,
  token: Address,
): Promise<number> => {
  if (token == ETH_ADDRESS) {
    return 18;
  } else {
    return await publicClient.readContract({
      abi: erc20Abi,
      functionName: "decimals",
      address: token,
    });
  }
};

const getTokenBalance = async (
  publicClient: PublicClient,
  token: Address,
  from: Address,
): Promise<bigint> => {
  if (token == ETH_ADDRESS) {
    return publicClient.getBalance({
      address: from,
    });
  } else {
    return await publicClient.readContract({
      abi: erc20Abi,
      functionName: "balanceOf",
      address: token,
      args: [from],
    });
  }
};

export const intentTransferTool = createTool({
  name: "intentTransfer",
  description: "Creates an intent to transfer tokens",
  supportedChains: intentTransferChains,
  parameters: intentTransferParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferParameters>,
  ): Promise<Intent> => {
    let { token, amount, to, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);
    const from = await client.getAddress();

    // if `to` is an ENS name, resolve it to an address
    if (to.includes('.')) {
      to = await resolveENSTool.execute(client, {
        name: to,
      })
    }

    const chainsWithBalance = (
      await Promise.all(
        chains.map(async (chain) => {
          const publicClient = client.getPublicClient(chain.id);
          const decimals = await getTokenDecimals(
            publicClient,
            token as Address,
          );

          const balance = await getTokenBalance(
            publicClient,
            token as Address,
            from,
          );

          const amountBigInt = parseUnits(amount, decimals);

          if (balance >= amountBigInt) {
            return {
              chain,
              balance,
              amount: amountBigInt,
              decimals,
            };
          }

          return null;
        }),
      )
    ).filter((chain): chain is NonNullable<typeof chain> => chain !== null);

    if (chainsWithBalance.length === 0) {
      throw new Error(
        `${from} doesn't have enough ${token} balance on any of the supported chains - ${chains.map((chain) => chain.name)}`,
      );
    }

    const cheapestChain = await Promise.all(
      chainsWithBalance.map(async (chainInfo) => {
        const publicClient = client.getPublicClient(chainInfo.chain.id);
        const gasPrice = await publicClient.getGasPrice();
        return {
          ...chainInfo,
          gasPrice,
        };
      }),
    ).then((chains) =>
      chains.reduce((cheapest, current) =>
        current.gasPrice < cheapest.gasPrice ? current : cheapest,
      ),
    );

    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    let ops = [];
    let tokenSymbol = "";
    if (token === ETH_ADDRESS) {
      tokenSymbol = "ETH";
      ops.push({
        target: to as Address,
        value: cheapestChain.amount.toString(),
        data: "0x" as Hex,
      });
    } else {
      tokenSymbol = await client.getPublicClient(cheapestChain.chain.id).readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "symbol",
      });

      ops.push({
        target: token as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, cheapestChain.amount],
        }),
      });
    }

    if (!walletClient) {
      return {
        intent: `send ${amount.toString()} ${tokenSymbol} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await client.executeOps(ops, cheapestChain.chain.id);

      return {
        intent: `send ${amount.toString()} ${tokenSymbol} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});

const intentTransferFromParameters = z.object({
  token: z.string().describe("The token address"),
  amount: z.string().describe("The amount to transfer"),
  from: z.string().describe("The address to transfer from"),
  to: z.string().describe("The recipient address or ENS"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

const intentTransferFromChains = [mainnet, arbitrum, base, sepolia];

export const intentTransferFromTool = createTool({
  name: "intentTransferFrom",
  description: "Creates an intent to transfer tokens from another address",
  supportedChains: intentTransferFromChains,
  parameters: intentTransferFromParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferFromParameters>,
  ): Promise<Intent> => {
    let { token, amount, to, from, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);

    // if `to` is an ENS name, resolve it to an address
    if (to.includes('.')) {
      to = await resolveENSTool.execute(client, {
        name: to,
      })
    }

    const chainsWithBalance = (
      await Promise.all(
        chains.map(async (chain) => {
          const publicClient = client.getPublicClient(chain.id);
          const decimals = await getTokenDecimals(
            publicClient,
            token as Address,
          );

          const balance = await getTokenBalance(
            publicClient,
            token as Address,
            from as Address,
          );

          const amountBigInt = parseUnits(amount, decimals);

          if (balance >= amountBigInt) {
            return {
              chain,
              balance,
              amount: amountBigInt,
              decimals,
            };
          }

          return null;
        }),
      )
    ).filter((chain): chain is NonNullable<typeof chain> => chain !== null);

    if (chainsWithBalance.length === 0) {
      throw new Error(
        `${from} doesn't have enough ${token} balance on any of the supported chains - ${chains.map((chain) => chain.name)}`,
      );
    }

    const cheapestChain = await Promise.all(
      chainsWithBalance.map(async (chainInfo) => {
        const publicClient = client.getPublicClient(chainInfo.chain.id);
        const gasPrice = await publicClient.getGasPrice();
        return {
          ...chainInfo,
          gasPrice,
        };
      }),
    ).then((chains) =>
      chains.reduce((cheapest, current) =>
        current.gasPrice < cheapest.gasPrice ? current : cheapest,
      ),
    );

    const publicClient = client.getPublicClient(cheapestChain.chain.id);
    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    let ops = [];
    if (token === ETH_ADDRESS) {
      // @TODO gracefully fallback to weth if eth mentioned
      throw new Error("ETH transferFrom not supported");
    } else {
      ops.push({
        target: token as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transferFrom",
          args: [from as Address, to as Address, cheapestChain.amount],
        }),
      });
    }

    if (!walletClient) {
      return {
        intent: `send ${amount.toString()} ${token} from ${from} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await client.executeOps(ops, cheapestChain.chain.id);

      return {
        intent: `send ${amount.toString()} ${token} from ${from} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});
