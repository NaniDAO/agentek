import { parseExactUnits } from "../utils/exact.js";
import { identityAddress } from "../utils/exact.js";
import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  PublicClient,
} from "viem";
import { erc20Chains } from "./constants.js";

const intentApproveParameters = z.object({
  token: identityAddress.describe("The token address"),
  amount: z.string().describe('The amount to approve. Use "max" for unlimited approval (type(uint256).max)'),
  spender: identityAddress.describe("The spender address to approve"),
  chainId: z.number().int().positive().safe().optional().describe("Optional specific chain to use"),
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
  description: 'Creates an intent to approve token spending. Supports "max" for unlimited approval.',
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

    if (chains.length !== 1) throw new Error("Specify chainId explicitly when multiple chains are configured");
    const publicClient = client.getPublicClient(chains[0].id);
    const decimals = await getTokenDecimals(publicClient, token as Address);
    const executionChain = {chain: chains[0], amount: amount.toLowerCase() === "max" ? maxUint256 : parseExactUnits(amount, decimals)};
    const walletClient = client.getWalletClient(executionChain.chain.id);

    const current = await publicClient.readContract({address: token as Address, abi: erc20Abi, functionName: "allowance", args: [from, spender as Address]});
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

    if (current > 0n && executionChain.amount > 0n) ops.unshift({target: token as Address, value: "0", data: encodeFunctionData({abi: erc20Abi, functionName: "approve", args: [spender as Address, 0n]})});

    const displayAmount = amount.toLowerCase() === "max" ? "max (unlimited)" : amount.toString();

    if (!walletClient) {
      return {
        intent: `approve ${displayAmount} ${token} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
      };
    } else {
      const hash = await client.executeOps(ops, executionChain.chain.id);

      return {
        intent: `Approve ${displayAmount} ${token} from ${from} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
        hash: hash,
      };
    }
  },
});
