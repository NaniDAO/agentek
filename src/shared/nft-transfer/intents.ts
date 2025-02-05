import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import { Address, encodeFunctionData, erc721Abi } from "viem";

const intentTransferChains = [mainnet, arbitrum, base, sepolia];

const intentTransferParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID of the NFT to transfer"),
  to: z.string().describe("The recipient address"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const intentNFTTransferTool = createTool({
  name: "intentNFTTransfer",
  description: "Creates an intent to transfer an NFT to another address",
  supportedChains: intentTransferChains,
  parameters: intentTransferParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, to, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);
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
        functionName: "transferFrom",
        args: [from as Address, to as Address, BigInt(tokenId)],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `transfer NFT ${nft} token ID ${tokenId} to ${to}`,
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
        intent: `transfer NFT ${nft} token ID ${tokenId} to ${to} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});

export const intentNFTSafeTransferTool = createTool({
  name: "intentNFTSafeTransfer",
  description: "Creates an intent to safely transfer an NFT to another address",
  supportedChains: intentTransferChains,
  parameters: intentTransferParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, to, chainId } = args;
    const chains = client.filterSupportedChains(intentTransferChains, chainId);
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
        functionName: "safeTransferFrom",
        args: [from as Address, to as Address, BigInt(tokenId)],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `safely transfer NFT ${nft} token ID ${tokenId} to ${to}`,
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
        intent: `safely transfer NFT ${nft} token ID ${tokenId} to ${to} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash: hash,
      };
    }
  },
});