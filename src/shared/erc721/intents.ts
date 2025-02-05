import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import { Address, encodeFunctionData, erc721Abi } from "viem";
import { erc721Chains } from "./constants";

const intentTransferParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID of the NFT to transfer"),
  to: z.string().describe("The recipient address"),
  chainId: z.number().describe("The chain ID to use"),
});

const intentApproveParameters = z.object({
  nft: z.string().describe("The NFT contract address"),
  tokenId: z.string().describe("The token ID of the NFT"),
  approved: z
    .string()
    .describe("The address being approved to transfer this NFT"),
  chainId: z.number().describe("The chain ID to use"),
});

export const intentNFTTransferTool = createTool({
  name: "intentNFTTransfer",
  description: "Creates an intent to transfer an NFT to another address",
  supportedChains: erc721Chains,
  parameters: intentTransferParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, to, chainId } = args;
    const chains = client.filterSupportedChains(erc721Chains, chainId);
    const from = await client.getAddress();

    // Find the chain with the lowest gas price
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

    // Verify NFT ownership
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to verify NFT ownership: ${errorMsg}`);
    }

    const ops = [
      {
        target: nft as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc721Abi,
          functionName: "transferFrom",
          args: [from as Address, to as Address, BigInt(tokenId)],
        }),
      },
    ];

    // If walletClient is not available, return a RequestIntent
    if (!walletClient) {
      return {
        intent: `transfer NFT ${nft} token ID ${tokenId} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      // Send the transaction using the wallet client
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: 0n,
        data: ops[0].data,
      });

      // Wait for the transaction to be included (at least 1 confirmation)
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      return {
        intent: `transfer NFT ${nft} token ID ${tokenId} to ${to} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash,
      };
    }
  },
});

export const intentNFTSafeTransferTool = createTool({
  name: "intentNFTSafeTransfer",
  description: "Creates an intent to safely transfer an NFT to another address",
  supportedChains: erc721Chains,
  parameters: intentTransferParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, to, chainId } = args;
    const chains = client.filterSupportedChains(erc721Chains, chainId);
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

    // Verify NFT ownership
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to verify NFT ownership: ${errorMsg}`);
    }

    const ops = [
      {
        target: nft as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc721Abi,
          functionName: "safeTransferFrom",
          args: [from as Address, to as Address, BigInt(tokenId)],
        }),
      },
    ];

    if (!walletClient) {
      return {
        intent: `safely transfer NFT ${nft} token ID ${tokenId} to ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: 0n,
        data: ops[0].data,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      return {
        intent: `safely transfer NFT ${nft} token ID ${tokenId} to ${to} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash,
      };
    }
  },
});

export const intentNFTApproveTool = createTool({
  name: "intentNFTApprove",
  description:
    "Creates an intent to approve an address to transfer a specific NFT",
  supportedChains: erc721Chains,
  parameters: intentApproveParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentApproveParameters>,
  ): Promise<Intent> => {
    const { nft, tokenId, approved, chainId } = args;
    const chains = client.filterSupportedChains(erc721Chains, chainId);
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

    // Verify NFT ownership
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to verify NFT ownership: ${errorMsg}`);
    }

    const ops = [
      {
        target: nft as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc721Abi,
          functionName: "approve",
          args: [approved as Address, BigInt(tokenId)],
        }),
      },
    ];

    if (!walletClient) {
      return {
        intent: `Approve ${approved} to transfer NFT ${nft} token ID ${tokenId}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: 0n,
        data: ops[0].data,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      return {
        intent: `Approve ${approved} to transfer NFT ${nft} token ID ${tokenId} from ${from}`,
        ops,
        chain: cheapestChain.chain.id,
        hash,
      };
    }
  },
});
