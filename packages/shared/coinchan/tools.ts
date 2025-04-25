import { createTool } from "../client.js";
import { z } from "zod";
import { CoinchanAbi, CoinchanAddress, supportedChains } from "./constants.js";

export const coinchanGetCoins = createTool({
  name: "coinchanGetCoins",
  description: "Fetch a list of Coinchan token IDs between index ranges",
  supportedChains,
  parameters: z.object({
    chainId: z.number(),
    start: z.number(),
    finish: z.number(),
  }),
  execute: async (client, args) => {
    const { chainId, start, finish } = args;
    const publicClient = client.getPublicClient(chainId);
    const coins: bigint[] = await publicClient.readContract({
      address: CoinchanAddress,
      abi: CoinchanAbi,
      functionName: "getCoins",
      args: [start, finish]
    });
    return { start, finish, coins };
  }
});

export const coinchanGetCoinsCount = createTool({
  name: "coinchanGetCoinsCount",
  description: "Get total number of Coinchan tokens created",
  supportedChains,
  parameters: z.object({ chainId: z.number() }),
  execute: async (client, args) => {
    const { chainId } = args;
    const publicClient = client.getPublicClient(chainId);
    const count: bigint = await publicClient.readContract({
      address: CoinchanAddress,
      abi: CoinchanAbi,
      functionName: "getCoinsCount",
      args: []
    });
    return { count };
  }
});

export const coinchanGetVestableAmount = createTool({
  name: "coinchanGetVestableAmount",
  description: "Get the amount of liquidity currently available to vest for a locked Coinchan token",
  supportedChains,
  parameters: z.object({
    chainId: z.number(),
    coinId: z.bigint(),
  }),
  execute: async (client, args) => {
    const { chainId, coinId } = args;
    const publicClient = client.getPublicClient(chainId);

    const vestable: bigint = await publicClient.readContract({
      address: CoinchanAddress,
      abi: CoinchanAbi,
      functionName: "getVestableAmount",
      args: [coinId]
    });

    return { coinId, vestable: vestable.toString() };
  }
});
