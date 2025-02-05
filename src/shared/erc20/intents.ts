import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  PublicClient,
} from "viem";
import { erc20Chains } from "./constants";

const intentApproveParameters = z.object({
  token: z.string().describe("The token address"),
  amount: z.string().describe("The amount to approve"),
  spender: z.string().describe("The spender address to approve"),
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

export const intentApproveTool = createTool({
  name: "intentApprove",
  description: "Creates an intent to approve token spending",
  supportedChains: erc20Chains,
  parameters: intentApproveParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentApproveParameters>,
  ): Promise<Intent> => {
    const { token, amount, spender, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);
    const from = await client.getAddress();

    if (token === ETH_ADDRESS) {
      throw new Error("Cannot approve ETH, only ERC20 tokens");
    }

    const chainsInfo = (
      await Promise.all(
        chains.map(async (chain) => {
          try {
            const publicClient = client.getPublicClient(chain.id);
            const decimals = await getTokenDecimals(
              publicClient,
              token as Address,
            );

            const amountBigInt = parseUnits(amount, decimals);

            return {
              chain,
              amount: amountBigInt,
              decimals,
            };
          } catch (error) {
            console.error(`Error processing chain ${chain.id}:`, error);
            return undefined;
          }
        }),
      )
    ).filter(
      (chainInfo): chainInfo is NonNullable<typeof chainInfo> =>
        chainInfo !== undefined,
    );

    let executionChain;
    if (chainsInfo.length === 0) {
      throw new Error("No supported chains found with valid token information");
    } else {
      executionChain = await Promise.all(
        chainsInfo.map(async (chainInfo) => {
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
    }

    const walletClient = client.getWalletClient(executionChain.chain.id);

    const ops = [
      {
        target: token as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, executionChain.amount],
        }),
      },
    ];

    if (!walletClient) {
      return {
        intent: `approve ${amount.toString()} ${token} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
      };
    } else {
      if (!ops[0]) {
        throw new Error("Operations array is empty or undefined");
      }

      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: 0n,
        data: ops[0].data,
      });

      await client
        .getPublicClient(executionChain.chain.id)
        .waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

      return {
        intent: `Approve ${amount.toString()} ${token} from ${from} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
        hash: hash,
      };
    }
  },
});
