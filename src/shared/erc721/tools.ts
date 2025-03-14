import { z } from "zod";
import { createTool } from "../client";
import { clean, addressSchema } from "../utils";
import { supportedChains } from "./constants";
import { erc721Abi } from "viem";

export const getNFTMetadataTool = createTool({
  name: "getNFTMetadata",
  description: "Gets metadata for an NFT token by contract address and token ID",
  supportedChains,
  parameters: z.object({
    contractAddress: addressSchema.describe("The NFT contract address"),
    tokenId: z.string().describe("The token ID of the NFT"),
    chainId: z.number().describe("The chain ID where the NFT exists"),
  }),
  execute: async (client, args) => {
    const { contractAddress, tokenId, chainId } = args;
    const publicClient = client.getPublicClient(chainId);
    
    try {
      // Get basic NFT information
      const [name, symbol, tokenURI] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: erc721Abi,
          functionName: "name",
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: erc721Abi,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: erc721Abi,
          functionName: "tokenURI",
          args: [BigInt(tokenId)],
        }),
      ]);
      
      // Get owner of NFT
      let owner = "";
      try {
        owner = await publicClient.readContract({
          address: contractAddress,
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
        });
      } catch (error) {
        return {
          chain: chainId,
          error: `Failed to fetch NFT owner: ${
            typeof error === "object" && error
              ? "shortMessage" in error
                ? error.shortMessage
                : "message" in error
                  ? error.message
                  : "Unknown error"
              : String(error)
          }`,
        };
      }
      
      // Fetch metadata from tokenURI if it exists
      let metadata = null;
      if (tokenURI) {
        try {
          // Handle both HTTP and IPFS URIs
          const url = tokenURI.startsWith('ipfs://')
            ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}`
            : tokenURI;
            
          const response = await fetch(url);
          if (response.ok) {
            metadata = await response.json();
          }
        } catch (error) {
          // Silently handle error but continue with other data
        }
      }
      
      return clean({
        chain: chainId,
        contractAddress,
        tokenId,
        name,
        symbol,
        owner,
        tokenURI,
        metadata,
      });
    } catch (error) {
      return {
        chain: chainId,
        error: `Failed to fetch NFT metadata: ${
          typeof error === "object" && error
            ? "shortMessage" in error
              ? error.shortMessage
              : "message" in error
                ? error.message
                : "Unknown error"
            : String(error)
        }`,
      };
    }
  },
});