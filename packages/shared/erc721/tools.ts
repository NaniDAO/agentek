import { publicFetch } from "../utils/public-fetch.js";
import { quantitySchema } from "../utils/exact.js";
import { z } from "zod";
import { createTool } from "../client.js";
import { clean, addressSchema } from "../utils.js";
import { supportedChains } from "./constants.js";
import { erc721Abi } from "viem";
import { safeErrorMessage } from "../utils/safe-errors.js";

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
function inlineMetadata(uri: string): unknown {
  const match = /^data:application\/json(?:;charset=utf-8)?(;base64)?,/i.exec(uri);
  if (!match || uri.length > MAX_METADATA_BYTES * 3) throw new Error("Unsupported or oversized inline metadata");
  const encoded = uri.slice(match[0].length);
  let text: string;
  if (match[1]) {
    if (encoded.length > Math.ceil(MAX_METADATA_BYTES / 3) * 4) throw new Error("Inline metadata too large");
    const decoded = atob(encoded);
    if (decoded.length > MAX_METADATA_BYTES) throw new Error("Inline metadata too large");
    text = new TextDecoder("utf-8", {fatal: true}).decode(Uint8Array.from(decoded, char => char.charCodeAt(0)));
  } else text = decodeURIComponent(encoded);
  if (new TextEncoder().encode(text).byteLength > MAX_METADATA_BYTES) throw new Error("Inline metadata too large");
  return JSON.parse(text);
}

export const getNFTMetadataTool = createTool({
  name: "getNFTMetadata",
  description: "Gets metadata for an NFT token by contract address and token ID",
  supportedChains,
  parameters: z.object({
    contractAddress: addressSchema.describe("The NFT contract address"),
    tokenId: quantitySchema.describe("The token ID of the NFT"),
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
          error: `Failed to fetch NFT owner: ${safeErrorMessage(error)}`,
        };
      }
      
      // Fetch metadata from tokenURI if it exists
      let metadata = null;
      let metadataError: string | undefined;
      if (tokenURI) {
        try {
          // Handle both HTTP and IPFS URIs
          const url = tokenURI.startsWith('ipfs://')
            ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}`
            : tokenURI;
            
          if (url.startsWith("data:")) metadata = inlineMetadata(url);
          else {
          const response = await publicFetch(url);
          if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
          metadata = await response.json();
          }
        } catch (error) {
          metadataError = safeErrorMessage(error);
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
        metadataError,
      });
    } catch (error) {
      return {
        chain: chainId,
        error: `Failed to fetch NFT metadata: ${safeErrorMessage(error)}`,
      };
    }
  },
});
