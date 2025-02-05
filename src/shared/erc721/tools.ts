import { z } from "zod";
import { createTool } from "../client";
import { Address, erc721Abi } from "viem";
import { erc721Chains } from "./constants";

const ownerCheckParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID to check ownership of"),
  chainId: z.number().describe("Optional specific chain to use"),
});

export const checkNFTOwnerTool = createTool({
  name: "checkNFTOwner",
  description: "Checks the current owner of a specific NFT token ID",
  supportedChains: erc721Chains,
  parameters: ownerCheckParameters,
  execute: async (client, args) => {
    const { nft, tokenId, chainId } = args;

    const publicClient = client.getPublicClient(chainId);
    try {
      const owner = await publicClient.readContract({
        address: nft as Address,
        abi: erc721Abi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      });

      return {
        chain: chainId,
        owner: owner,
      };
    } catch (error) {
      return {
        chain: chainId,
        error: `Failed to fetch owner: ${error?.shortMessage ?? error?.message}`,
      };
    }

    return {
      nft,
      tokenId,
    };
  },
});
