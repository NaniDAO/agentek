import { z } from "zod";
import { AgentekClient, createTool } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import { Address, erc721Abi } from "viem";

const ownerCheckChains = [mainnet, arbitrum, base, sepolia];

const ownerCheckParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID to check ownership of"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const checkNFTOwnerTool = createTool({
  name: "checkNFTOwner",
  description: "Checks the current owner of a specific NFT token ID",
  supportedChains: ownerCheckChains,
  parameters: ownerCheckParameters,
  execute: async (client, args) => {
    const { nft, tokenId, chainId } = args;
    const chains = client.filterSupportedChains(ownerCheckChains, chainId);

    const owners = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const owner = await publicClient.readContract({
            address: nft as Address,
            abi: erc721Abi,
            functionName: "ownerOf",
            args: [BigInt(tokenId)],
          });

          return {
            chain: chain.name,
            chainId: chain.id,
            owner: owner,
          };
        } catch (error) {
          return {
            chain: chain.name,
            chainId: chain.id,
            error: `Failed to fetch owner: ${error.message}`,
          };
        }
      }),
    );

    return {
      nft,
      tokenId,
      owners,
    };
  },
});