import { z } from "zod";
import { AgentekClient, createTool} from "../client.js";
import { coinsAbi, COINS_ADDRESS } from "./constants.js";
import { addressSchema } from "../utils.js";

const getCoinTokenMetadataParameters = z.object({
  chainId: z.number(),
  tokenId: z.string().describe("Token ID as a stringified bigint (usually an address)"),
});

export const getCoinTokenMetadata = createTool({
  name: "getCoinTokenMetadata",
  description: "Returns the name, symbol, and URI of a given ERC6909 token ID from the Coins contract.",
  parameters: getCoinTokenMetadataParameters,
  execute: async (client: AgentekClient, args: z.infer<typeof getCoinTokenMetadataParameters>) => {
    const { chainId, tokenId } = args;
    const tokenIdBigInt = BigInt(tokenId);
    const publicClient = client.getPublicClient(chainId);

    const [name, symbol, uri] = await Promise.all([
      publicClient.readContract({
        address: COINS_ADDRESS,
        abi: coinsAbi,
        functionName: "name",
        args: [tokenIdBigInt],
      }),
      publicClient.readContract({
        address: COINS_ADDRESS,
        abi: coinsAbi,
        functionName: "symbol",
        args: [tokenIdBigInt],
      }),
      publicClient.readContract({
        address: COINS_ADDRESS,
        abi: coinsAbi,
        functionName: "uri",
        args: [tokenIdBigInt],
      }),
    ]);

    return { name, symbol, uri };
  },
});

const getCoinBalanceParameters = z.object({
  chainId: z.number(),
  account: addressSchema.describe("User's wallet address"),
  tokenId: z.string().describe("Token ID as a stringified bigint"),
});

export const getCoinBalance = createTool({
  name: "getCoinBalance",
  description: "Returns the balance of a given address for a specific ERC6909 token ID from the Coins contract.",
  parameters: getCoinBalanceParameters,
  execute: async (client: AgentekClient, args: z.infer<typeof getCoinBalanceParameters>) => {
    const { chainId, account, tokenId } = args;
    const tokenIdBigInt = BigInt(tokenId);
    const publicClient = client.getPublicClient(chainId);

    const balance = await publicClient.readContract({
      address: COINS_ADDRESS,
      abi: coinsAbi,
      functionName: "balanceOf",
      args: [account, tokenIdBigInt],
    });

    return { account, tokenId, balance: balance.toString() };
  },
});
