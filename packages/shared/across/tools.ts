import { createTool } from "../client.js";
import { z } from "zod";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import { erc20Abi, parseUnits } from "viem";

/**
 * It calls the endpoint at:
 *   https://across.to/api/suggested-fees
 */
export const getAcrossFeeQuote = createTool({
  name: "getAcrossFeeQuote",
  description:
    "Fetches a suggested fee quote for a cross-chain asset bridge using the Across Protocol REST API.",
  parameters: z.object({
    inputToken: z
      .string()
      .describe(
        "The token contract address on the origin chain (e.g., WETH address).",
      ),
    outputToken: z
      .string()
      .describe(
        "The token contract address on the destination chain (e.g., corresponding WETH address).",
      ),
    originChainId: z
      .number()
      .describe("Chain ID where the input token exists."),
    destinationChainId: z
      .number()
      .describe("Chain ID of the destination chain."),
    amount: z.string().describe("Amount of tokens to bridge (in ether)"),
    recipient: z
      .string()
      .describe("Recipient address on the destination chain."),
  }),
  supportedChains: [mainnet, polygon, arbitrum, optimism, base],
  async execute(client, args) {
    const publicClient = client.getPublicClient(args.originChainId);

    const decimals = await publicClient.readContract({
      address: args.inputToken as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });

    const queryParams = new URLSearchParams({
      inputToken: args.inputToken,
      outputToken: args.outputToken,
      originChainId: args.originChainId.toString(),
      destinationChainId: args.destinationChainId.toString(),
      amount: parseUnits(args.amount, decimals).toString(),
    });

    if (args.recipient) queryParams.append("recipient", args.recipient);

    const apiUrl = `https://across.to/api/suggested-fees?${queryParams.toString()}`;

    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Across REST API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const result = await response.json();
      return result;
    } catch (err: any) {
      throw new Error(`Across fee quote retrieval failed: ${err.message}`);
    }
  },
});
