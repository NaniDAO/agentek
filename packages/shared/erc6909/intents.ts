import { createTool, AgentekClient } from "../client.js";
import { z } from "zod";
import { encodeFunctionData, parseEther } from "viem";
import { coinsAbi, COINS_ADDRESS } from "./constants.js";
import { addressSchema } from "../utils.js";

const intentCreateCoinTokenParameters = z.object({
  chainId: z.number().describe("The chainId to deploy on e.g. 1 (mainnet), 8453 (base)"),
  name: z.string().describe("Token name"),
  symbol: z.string().describe("Token symbol"),
  tokenURI: z.string().describe("Metadata URI"),
  owner: addressSchema.describe("Owner address"),
  supply: z.string().describe("Initial supply as a human readable string (e.g., '1000')"),
})

export const intentCreateCoinToken = createTool({
  name: "intentCreateCoinToken",
  description: "Creates a new ERC6909 token inside the Coins contract with a name, symbol, metadata URI, owner, and initial supply.",
  parameters: intentCreateCoinTokenParameters,
  execute: async (client: AgentekClient, args: z.infer<typeof intentCreateCoinTokenParameters>,) => {
    const { chainId, name, symbol, tokenURI, owner, supply } = args;

    const walletClient = client.getWalletClient(chainId);

    const data = encodeFunctionData({
      abi: coinsAbi,
      functionName: "create",
      args: [name, symbol, tokenURI, owner, parseEther(supply)],
    });

    const ops = [
      {
        target: COINS_ADDRESS,
        value: "0",
        data,
      },
    ];

    const description = `🪙 Creating "${name}" token (${symbol}) \n💰 Initial supply: ${supply} \n👤 Owner: ${owner}`;

    if (!walletClient) {
      return {
        intent: description,
        ops,
        chain: chainId,
      };
    }

    const hash = await client.executeOps(ops, chainId);
    return {
      intent: description,
      ops,
      chain: chainId,
      hash,
    };
  },
});
