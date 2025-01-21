import { z } from "zod";
import { createTool } from "../client";
import {
  arbitrum,
  base,
  mainnet,
  mode,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";
import { clean } from "../utils";
import { Address, encodeFunctionData, erc721Abi, maxUint128 } from "viem";

const supportedChains = [
  mainnet,
  base,
  arbitrum,
  polygon,
  optimism,
  mode,
  sepolia,
];

const getUniV3Pool = createTool({
  name: "getUniV3Pool",
  description: "Gets information about a Uniswap V3 pool",
  supportedChains,
  parameters: z.object({
    poolAddress: z.string(),
    chainId: z.number(),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(args.chainId);

    const poolAbi = [
      {
        inputs: [],
        name: "slot0",
        outputs: [
          { type: "uint160", name: "sqrtPriceX96" },
          { type: "int24", name: "tick" },
          { type: "uint16", name: "observationIndex" },
          { type: "uint16", name: "observationCardinality" },
          { type: "uint16", name: "observationCardinalityNext" },
          { type: "uint8", name: "feeProtocol" },
          { type: "bool", name: "unlocked" },
        ],
        stateMutability: "view",
        type: "function",
      },
    ];

    const poolData = await publicClient.readContract({
      address: args.poolAddress as Address,
      abi: poolAbi,
      functionName: "slot0",
    });

    return clean({
      sqrtPriceX96: poolData[0].toString(),
      tick: poolData[1].toString(),
      unlocked: poolData[6],
    });
  },
});

const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "mint",
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "decreaseLiquidity",
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "increaseLiquidity",
    outputs: [
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint256" },
          { name: "amount1Max", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "collect",
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
];

const POSITION_MANAGER_ADDRESS =
  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as Address;

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
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
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
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
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
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
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
      abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
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
