import { createTool } from "../client.js";
import { z } from "zod";
import { CoinchanAbi, CoinchanAddress, supportedChains } from "./constants.js";

export const coinchanGetCoins = createTool({
  name: "coinchanGetCoins",
  description: "Fetch a list of Coinchan token IDs between index ranges. Use coinchanGetCoinsCount first to know the valid range.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID (e.g. 8453 for Base)"),
    start: z.number().describe("Start index (0-based) of the token range to fetch"),
    finish: z.number().describe("End index (exclusive) of the token range to fetch"),
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
  description: "Get the total number of Coinchan tokens created on the given chain.",
  supportedChains,
  parameters: z.object({ chainId: z.number().describe("Chain ID (e.g. 8453 for Base)") }),
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
  description: "Get the amount of liquidity currently available to vest for a locked Coinchan token.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID (e.g. 8453 for Base)"),
    coinId: z.string().describe("The Coinchan token ID as a decimal string"),
  }),
  execute: async (client, args) => {
    const { chainId, coinId } = args;
    const publicClient = client.getPublicClient(chainId);

    const vestable: bigint = await publicClient.readContract({
      address: CoinchanAddress,
      abi: CoinchanAbi,
      functionName: "getVestableAmount",
      args: [BigInt(coinId)]
    });

    return { coinId, vestable: vestable.toString() };
  }
});
