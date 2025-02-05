import { BaseTool, createToolCollection } from "../client";
import { z } from "zod";
import { createTool } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import { Address, erc20Abi } from "viem";

const allowanceCheckChains = [mainnet, arbitrum, base, sepolia];

const checkAllowanceParameters = z.object({
  token: z.string().describe("The token address"),
  owner: z.string().describe("The token owner's address"),
  spender: z.string().describe("The spender's address"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const checkAllowanceTool = createTool({
  name: "checkAllowance",
  description: "Checks the ERC20 token allowance between an owner and spender",
  supportedChains: allowanceCheckChains,
  parameters: checkAllowanceParameters,
  execute: async (client, args) => {
    const { token, owner, spender, chainId } = args;
    const chains = client.filterSupportedChains(allowanceCheckChains, chainId);

    const allowances = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const allowance = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner as Address, spender as Address],
          });

          return {
            chain: chain.name,
            chainId: chain.id,
            allowance: allowance.toString(),
          };
        } catch (error) {
          return {
            chain: chain.name,
            chainId: chain.id,
            error: `Failed to fetch allowance: ${error.message}`,
          };
        }
      }),
    );

    return {
      token,
      owner,
      spender,
      allowances,
    };
  },
});
