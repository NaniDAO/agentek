import { z } from "zod";
import { createTool } from "../client";
import { Address, formatEther, Hex, formatUnits, parseEther } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";

const supportedChains = [mainnet, base, arbitrum];

const getBalance = createTool({
  name: "getBalance",
  description: "Get the ETH balance for an address",
  supportedChains,
  parameters: z.object({
    address: z.string(),
    chainId: z.number().optional(),
    formatEth: z.boolean().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      const balance = await publicClient.getBalance({
        address: args.address as Address,
      });
      return args.formatEth ? formatEther(balance) : balance.toString();
    }

    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const balance = await publicClient.getBalance({
          address: args.address as Address,
        });
        return {
          chainId: chain.id,
          balance: args.formatEth ? formatEther(balance) : balance.toString(),
        };
      }),
    );
    return results;
  },
});

const getCode = createTool({
  name: "getCode",
  description: "Get the bytecode of an address",
  supportedChains,
  parameters: z.object({
    address: z.string(),
    chainId: z.number().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      return publicClient.getCode({ address: args.address as Address });
    }

    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const code = await publicClient.getCode({
          address: args.address as Address,
        });
        return {
          chainId: chain.id,
          code,
        };
      }),
    );
    return results;
  },
});

const getTransactionCount = createTool({
  name: "getTransactionCount",
  description: "Get the number of transactions sent from an address",
  supportedChains,
  parameters: z.object({
    address: z.string(),
    chainId: z.number().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      return publicClient.getTransactionCount({
        address: args.address as Address,
      });
    }

    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const count = await publicClient.getTransactionCount({
          address: args.address as Address,
        });
        return {
          chainId: chain.id,
          count,
        };
      }),
    );
    return results;
  },
});

// Block Tools
const getBlock = createTool({
  name: "getBlock",
  description: "Get information about a block",
  supportedChains,
  parameters: z.object({
    blockNumber: z.number().optional(),
    blockHash: z.string().optional(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(args.chainId);
    if (args.blockHash) {
      return publicClient.getBlock({ blockHash: args.blockHash as Hex });
    }

    if (args.blockNumber) {
      return publicClient.getBlock({
        blockNumber: BigInt(args.blockNumber),
      });
    }

    return publicClient.getBlock();
  },
});

const getBlockNumber = createTool({
  name: "getBlockNumber",
  description: "Get the current block number",
  supportedChains,
  parameters: z.object({
    chainId: z.number().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      return publicClient.getBlockNumber();
    }

    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const blockNumber = await publicClient.getBlockNumber();
        return {
          chainId: chain.id,
          blockNumber,
        };
      }),
    );
    return results;
  },
});

// Gas Tools
const getGasPrice = createTool({
  name: "getGasPrice",
  description: "Get the current gas price",
  supportedChains,
  parameters: z.object({
    chainId: z.number().optional(),
    formatGwei: z.boolean().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      const gasPrice = await publicClient.getGasPrice();
      return args.formatGwei ? formatUnits(gasPrice, 9) : gasPrice.toString();
    }

    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const gasPrice = await publicClient.getGasPrice();
        return {
          chainId: chain.id,
          gasPrice: args.formatGwei
            ? formatUnits(gasPrice, 9)
            : gasPrice.toString(),
        };
      }),
    );
    return results;
  },
});

const estimateGas = createTool({
  name: "estimateGas",
  description: "Estimate gas for a transaction",
  supportedChains,
  parameters: z.object({
    to: z.string(),
    value: z.string().optional(),
    data: z.string().optional(),
    chainId: z.number().optional(),
  }),
  execute: async (client, args) => {
    if (args.chainId) {
      const publicClient = client.getPublicClient(args.chainId);
      const from = await client.getAddress();
      return publicClient.estimateGas({
        account: from,
        to: args.to,
        value: args.value ? parseEther(args.value) : undefined,
        data: args.data as `0x${string}` | undefined,
      });
    }

    const from = await client.getAddress();
    const results = await Promise.all(
      supportedChains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const gas = await publicClient.estimateGas({
          account: from,
          to: args.to,
          value: args.value ? parseEther(args.value) : undefined,
          data: args.data as `0x${string}` | undefined,
        });
        return {
          chainId: chain.id,
          gas,
        };
      }),
    );
    return results;
  },
});

export {
  getBalance,
  getCode,
  getTransactionCount,
  getBlock,
  getBlockNumber,
  getGasPrice,
  estimateGas,
};
