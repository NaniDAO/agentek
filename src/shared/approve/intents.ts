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

const intentApproveChains = [mainnet, arbitrum, base, sepolia];
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
  supportedChains: intentApproveChains,
  parameters: intentApproveParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentApproveParameters>,
  ): Promise<Intent> => {
    const { token, amount, spender, chainId } = args;
    const chains = client.filterSupportedChains(intentApproveChains, chainId);
    const from = await client.getAddress();

    if (token === ETH_ADDRESS) {
      throw new Error("Cannot approve ETH, only ERC20 tokens");
    }

    const chainsInfo = await Promise.all(
      chains.map(async (chain) => {
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
      }),
    );

    const cheapestChain = await Promise.all(
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

    const publicClient = client.getPublicClient(cheapestChain.chain.id);
    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    const ops = [{
      target: token,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender as Address, cheapestChain.amount],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `approve ${amount.toString()} ${token} for spender ${spender}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: BigInt(ops[0].value),
        data: ops[0].data,
      });

      return {
        intent: `approve ${amount.toString()} ${token} from ${from} for spender ${spender}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});
