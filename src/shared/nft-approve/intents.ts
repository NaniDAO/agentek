import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import { Address, encodeFunctionData, erc721Abi } from "viem";

const intentApproveChains = [mainnet, arbitrum, base, sepolia];
const intentApproveParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID of the NFT"),
  approved: z.string().describe("The address being approved to transfer this NFT"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const intentNFTApproveTool = createTool({
  name: "intentNFTApprove",
  description: "Creates an intent to approve an address to transfer a specific NFT",
  supportedChains: intentApproveChains,
  parameters: intentApproveParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentApproveParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, approved, chainId } = args;
    const chains = client.filterSupportedChains(intentApproveChains, chainId);
    const from = await client.getAddress();

    const cheapestChain = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const gasPrice = await publicClient.getGasPrice();
        return {
          chain,
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

    // Verify ownership
    try {
      const owner = await publicClient.readContract({
        address: nft as Address,
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      });

      if (owner.toLowerCase() !== from.toLowerCase()) {
        throw new Error("You don't own this NFT");
      }
    } catch (error) {
      throw new Error(`Failed to verify NFT ownership: ${error.message}`);
    }

    const ops = [{
      target: nft,
      value: "0",
      data: encodeFunctionData({
        abi: erc721Abi,
        functionName: "approve",
        args: [approved as Address, BigInt(tokenId)],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `approve ${approved} to transfer NFT ${nft} token ID ${tokenId}`,
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
        intent: `approve ${approved} to transfer NFT ${nft} token ID ${tokenId} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});