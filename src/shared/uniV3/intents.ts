import { z } from "zod";
import { createTool } from "../client";
import { supportedChains } from "./constants";

import { Address, encodeFunctionData, erc721Abi, maxUint128 } from "viem";
import {
  nonfungiblePositionManagerAbi,
  POSITION_MANAGER_ADDRESS,
} from "./constants";

const intentMintPosition = createTool({
  name: "intentMintPosition",
  description: "Creates a new Uniswap V3 liquidity position",
  supportedChains,
  parameters: z.object({
    token0: z.string(),
    token1: z.string(),
    fee: z.number(),
    tickLower: z.number(),
    tickUpper: z.number(),
    amount0Desired: z.string(),
    amount1Desired: z.string(),
    slippageTolerance: z.number().default(0.5),
    recipient: z.string().optional(),
    deadline: z.number().optional(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(args.chainId);
    const user = await client.getAddress();
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;

    const amount0Desired = BigInt(args.amount0Desired);
    const amount1Desired = BigInt(args.amount1Desired);
    const amount0Min =
      (amount0Desired * (10000n - BigInt(args.slippageTolerance * 100))) /
      10000n;
    const amount1Min =
      (amount1Desired * (10000n - BigInt(args.slippageTolerance * 100))) /
      10000n;

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0: args.token0 as Address,
          token1: args.token1 as Address,
          fee: args.fee,
          tickLower: args.tickLower,
          tickUpper: args.tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          recipient: (args.recipient as Address) || user,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: POSITION_MANAGER_ADDRESS,
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Mint Uniswap V3 position for ${args.token0}/${args.token1}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await walletClient.sendTransaction({
      to: ops[0].target,
      value: BigInt(ops[0].value),
      data: ops[0].data,
    });

    return {
      intent: `Mint Uniswap V3 position for ${args.token0}/${args.token1}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentIncreaseLiquidity = createTool({
  name: "intentIncreaseLiquidity",
  description: "Adds more liquidity to an existing Uniswap V3 position",
  supportedChains,
  parameters: z.object({
    tokenId: z.string(),
    amount0Desired: z.string(),
    amount1Desired: z.string(),
    slippageTolerance: z.number().default(0.5),
    deadline: z.number().optional(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;
    const amount0Desired = BigInt(args.amount0Desired);
    const amount1Desired = BigInt(args.amount1Desired);
    const amount0Min =
      (amount0Desired * (10000n - BigInt(args.slippageTolerance * 100))) /
      10000n;
    const amount1Min =
      (amount1Desired * (10000n - BigInt(args.slippageTolerance * 100))) /
      10000n;

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "increaseLiquidity",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: POSITION_MANAGER_ADDRESS,
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Increase liquidity for position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await walletClient.sendTransaction({
      to: ops[0].target,
      value: BigInt(ops[0].value),
      data: ops[0].data,
    });

    return {
      intent: `Increase liquidity for position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentDecreaseLiquidity = createTool({
  name: "intentDecreaseLiquidity",
  description: "Removes liquidity from a Uniswap V3 position",
  supportedChains,
  parameters: z.object({
    tokenId: z.string(),
    liquidity: z.string(),
    slippageTolerance: z.number().default(0.5),
    deadline: z.number().optional(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;
    const liquidity = BigInt(args.liquidity);
    const amountMin =
      (liquidity * (10000n - BigInt(args.slippageTolerance * 100))) / 10000n;

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          liquidity,
          amount0Min: amountMin,
          amount1Min: amountMin,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: POSITION_MANAGER_ADDRESS,
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Decrease liquidity for position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await walletClient.sendTransaction({
      to: ops[0].target,
      value: BigInt(ops[0].value),
      data: ops[0].data,
    });

    return {
      intent: `Decrease liquidity for position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentCollectFees = createTool({
  name: "intentCollectFees",
  description: "Collects accumulated fees from a Uniswap V3 position",
  supportedChains,
  parameters: z.object({
    tokenId: z.string(),
    recipient: z.string().optional(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const user = await client.getAddress();
    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          recipient: (args.recipient as Address) || user,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
    });

    const ops = [
      {
        target: POSITION_MANAGER_ADDRESS,
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Collect fees from position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await walletClient.sendTransaction({
      to: ops[0].target,
      value: BigInt(ops[0].value),
      data: ops[0].data,
    });

    return {
      intent: `Collect fees from position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentTransferPosition = createTool({
  name: "intentTransferPosition",
  description: "Transfers ownership of a Uniswap V3 LP NFT",
  supportedChains,
  parameters: z.object({
    tokenId: z.string(),
    to: z.string(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const data = encodeFunctionData({
      abi: erc721Abi,
      functionName: "safeTransferFrom",
      args: [
        await client.getAddress(),
        args.to as Address,
        BigInt(args.tokenId),
      ],
    });

    const ops = [
      {
        target: POSITION_MANAGER_ADDRESS,
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Transfer position #${args.tokenId} to ${args.to}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await walletClient.sendTransaction({
      to: ops[0].target,
      value: BigInt(ops[0].value),
      data: ops[0].data,
    });

    return {
      intent: `Transfer position #${args.tokenId} to ${args.to}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

export {
  getUniV3Pool,
  intentMintPosition,
  intentIncreaseLiquidity,
  intentDecreaseLiquidity,
  intentCollectFees,
  intentTransferPosition,
};
