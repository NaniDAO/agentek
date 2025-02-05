import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  PublicClient,
} from "viem";

const intentTransferChains = [mainnet, arbitrum, base, sepolia];
const intentTransferParameters = z.object({
  token: z.string().describe("The token address"),
  amount: z.string().describe("The amount to transfer"),
  to: z.string().describe("The recipient address or ENS"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
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
    const { token, amount, to, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);
    const from = await client.getAddress();

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

    const publicClient = client.getPublicClient(cheapestChain.chain.id);
    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    let ops = [];
    if (token === ETH_ADDRESS) {
      ops.push({
        target: to,
        value: cheapestChain.amount.toString(),
        data: undefined,
      });
    } else {
      ops.push({
        target: token,
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
        intent: `send ${amount.toString()} ${token} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: BigInt(ops[0].value),
        data: ops[0].data,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      return {
        intent: `send ${amount.toString()} ${token} from ${from} to ${to}`,
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
    const { token, amount, to, from, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);

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
      // gracefully fallback to weth if eth mentioned
      throw new Error("ETH transferFrom not supported");
    } else {
      ops.push({
        target: token,
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
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: BigInt(ops[0].value),
        data: ops[0].data,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      return {
        intent: `send ${amount.toString()} ${token} from ${from} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});
