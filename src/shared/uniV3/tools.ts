import { z } from "zod";
import { createTool } from "../client";
import { clean } from "../utils";
import {
  nonfungiblePositionManagerAbi,
  POSITION_MANAGER_ADDRESS,
  supportedChains,
  uniV3poolAbi,
} from "./constants";
import { Address, erc721Abi } from "viem";

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
  description: "Gets detailed information about a specific LP position",
  supportedChains,
  parameters: z.object({
    tokenId: z.string(),
    chainId: z.number(),
  }),
  execute: async (client, { tokenId, chainId }) => {
    const publicClient = client.getPublicClient(chainId);

    const data = await publicClient.multicall({
      contracts: [
        {
          address: POSITION_MANAGER_ADDRESS[chainId],
          abi: nonfungiblePositionManagerAbi,
          functionName: "positions",
          args: [BigInt(tokenId)],
        },
        {
          address: POSITION_MANAGER_ADDRESS[chainId],
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
  description: "Gets all Uniswap V3 positions for a user",
  supportedChains,
  parameters: z.object({
    chainId: z.number(),
    user: z.string().optional(),
  }),
  execute: async (client, { chainId, user }) => {
    const publicClient = client.getPublicClient(chainId);
    const owner = user || (await client.getAddress());

    const balance = await publicClient.readContract({
      address: POSITION_MANAGER_ADDRESS[chainId],
      abi: nonfungiblePositionManagerAbi,
      functionName: "balanceOf",
      args: [owner as Address],
    });

    const tokenIds = await Promise.all(
      Array.from({ length: Number(balance) }).map((_, i) =>
        publicClient.readContract({
          address: POSITION_MANAGER_ADDRESS[chainId],
          abi: nonfungiblePositionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [owner as Address, BigInt(i)],
        }),
      ),
    );

    const positionDetails = await Promise.all(
      tokenIds.map((tokenId) =>
        publicClient.readContract({
          address: POSITION_MANAGER_ADDRESS[chainId],
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
  description: "Gets fee-related data for a pool",
  supportedChains,
  parameters: z.object({
    poolAddress: z.string(),
    chainId: z.number(),
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
      feeGrowth0: feeGrowthGlobal0X128.result.toString(),
      feeGrowth1: feeGrowthGlobal1X128.result.toString(),
      protocolFeesToken0: protocolFees.result[0].toString(),
      protocolFeesToken1: protocolFees.result[1].toString(),
    });
  },
});

export { getUniV3Pool, getUserPositions, getPoolFeeData, getPositionDetails };
