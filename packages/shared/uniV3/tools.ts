import { z } from "zod";
import { createTool } from "../client.js";
import { clean } from "../utils.js";
import {
  nonfungiblePositionManagerAbi,
  getPositionManagerAddress,
  supportedChains,
  uniV3poolAbi,
} from "./constants.js";
import { Address, erc721Abi } from "viem";
import { addressSchema } from "../utils.js";

const getUniV3Pool = createTool({
  name: "getUniV3Pool",
  description: "Gets the current state of a Uniswap V3 pool including sqrtPriceX96, current tick, and whether the pool is unlocked.",
  supportedChains,
  parameters: z.object({
    poolAddress: z.string().describe("The Uniswap V3 pool contract address (0x...)"),
    chainId: z.number().describe("Chain ID where the pool is deployed (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(args.chainId);

    const poolData = await publicClient.readContract({
      address: args.poolAddress as Address,
      abi: uniV3poolAbi,
      functionName: "slot0",
    });

    return clean({
      sqrtPriceX96: poolData[0].toString(),
      tick: poolData[1].toString(),
      unlocked: poolData[6],
    });
  },
});

const getPositionDetails = createTool({
  name: "getPositionDetails",
  description: "Gets detailed information about a specific Uniswap V3 LP position including token pair, fee tier, tick range, liquidity, and owed fees.",
  supportedChains,
  parameters: z.object({
    tokenId: z.string().describe("The NFT token ID of the LP position"),
    chainId: z.number().describe("Chain ID where the position exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, { tokenId, chainId }) => {
    const publicClient = client.getPublicClient(chainId);

    const data = await publicClient.multicall({
      contracts: [
        {
          address: getPositionManagerAddress(chainId),
          abi: nonfungiblePositionManagerAbi,
          functionName: "positions",
          args: [BigInt(tokenId)],
        },
        {
          address: getPositionManagerAddress(chainId),
          abi: erc721Abi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)],
        },
      ],
    });

    const [position, owner] = data;
    return clean({
      owner: owner.result,
      token0: position.result?.[2],
      token1: position.result?.[3],
      fee: position.result?.[4],
      tickLower: position.result?.[5],
      tickUpper: position.result?.[6],
      liquidity: position.result?.[7].toString(),
      tokensOwed0: position.result?.[10].toString(),
      tokensOwed1: position.result?.[11].toString(),
    });
  },
});

const getUserPositions = createTool({
  name: "getUserPositions",
  description: "Gets all Uniswap V3 LP positions owned by a user. Defaults to the connected wallet if no user address is provided.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID to query (e.g. 1, 8453, 42161)"),
    user: z.string().optional().describe("The wallet address to check. Omit to use the connected wallet."),
  }),
  execute: async (client, { chainId, user }) => {
    const publicClient = client.getPublicClient(chainId);
    const owner = user || (await client.getAddress());

    const balance = await publicClient.readContract({
      address: getPositionManagerAddress(chainId),
      abi: nonfungiblePositionManagerAbi,
      functionName: "balanceOf",
      args: [owner as Address],
    });

    const tokenIds = await Promise.all(
      Array.from({ length: Number(balance) }).map((_, i) =>
        publicClient.readContract({
          address: getPositionManagerAddress(chainId),
          abi: nonfungiblePositionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [owner as Address, BigInt(i)],
        }),
      ),
    );

    const positionDetails = await Promise.all(
      tokenIds.map((tokenId) =>
        publicClient.readContract({
          address: getPositionManagerAddress(chainId),
          abi: nonfungiblePositionManagerAbi,
          functionName: "positions",
          args: [tokenId],
        }),
      ),
    );

    return clean({
      positions: tokenIds.map((id, index) => ({
        tokenId: id.toString(),
        token0: positionDetails[index][2],
        token1: positionDetails[index][3],
        fee: positionDetails[index][4],
        tickLower: positionDetails[index][5],
        tickUpper: positionDetails[index][6],
        liquidity: positionDetails[index][7].toString(),
        tokensOwed0: positionDetails[index][10].toString(),
        tokensOwed1: positionDetails[index][11].toString(),
      })),
    });
  },
});

const getPoolFeeData = createTool({
  name: "getPoolFeeData",
  description: "Gets fee growth globals and protocol fee data for a Uniswap V3 pool.",
  supportedChains,
  parameters: z.object({
    poolAddress: addressSchema.describe("The Uniswap V3 pool contract address (0x...)"),
    chainId: z.number().describe("Chain ID where the pool is deployed (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, { poolAddress, chainId }) => {
    const publicClient = client.getPublicClient(chainId);

    const [feeGrowthGlobal0X128, feeGrowthGlobal1X128, protocolFees] =
      await publicClient.multicall({
        contracts: [
          {
            address: poolAddress,
            abi: uniV3poolAbi,
            functionName: "feeGrowthGlobal0X128",
          },
          {
            address: poolAddress,
            abi: uniV3poolAbi,
            functionName: "feeGrowthGlobal1X128",
          },
          {
            address: poolAddress,
            abi: uniV3poolAbi,
            functionName: "protocolFees",
          },
        ],
      });

    return clean({
      feeGrowth0: feeGrowthGlobal0X128.result?.toString() || "0",
      feeGrowth1: feeGrowthGlobal1X128.result?.toString() || "0",
      protocolFeesToken0: protocolFees.result?.[0]?.toString() || "0",
      protocolFeesToken1: protocolFees.result?.[1]?.toString() || "0",
    });
  },
});

export { getUniV3Pool, getUserPositions, getPoolFeeData, getPositionDetails };
