import { z } from "zod";
import { createTool } from "../client";
import { parseUnits } from "viem";
import { arbitrum, base, mainnet } from "viem/chains";

export const swapTool = createTool({
  name: "swap",
  description: "Swap tokens across supported DEXs and chains",
  supportedChains: [mainnet, arbitrum, base],
  parameters: z.object({
    tokenIn: z.string().describe("Address of token to swap from"),
    tokenOut: z.string().describe("Address of token to swap to"),
    amount: z.string().describe("Amount to swap in token decimals"),
    slippage: z.number().default(0.5).describe("Maximum slippage percentage"),
    chainId: z.number().optional().describe("Optional specific chain to use"),
  }),
  execute: async (client, args) => {
    const { chainId, tokenIn, tokenOut, amount, slippage } = args;

    if (chainId) {
      const publicClient = client.getPublicClient(chainId);
      const quote = await getQuote(publicClient, {
        tokenIn,
        tokenOut,
        amount: parseUnits(amount, 18),
      });

      return {
        chainId,
        quote: quote.quote,
        calldata: quote.calldata,
        expectedOutput: quote.expectedOutput,
      };
    }

    const publicClients = client.getPublicClients();
    const quotes = await Promise.all(
      Array.from(publicClients.entries())
        .filter(([chainId]) => swapTool.supportedChains?.includes(chainId))
        .map(async ([chainId, client]) => {
          try {
            const quote = await getQuote(client, {
              tokenIn,
              tokenOut,
              amount: parseUnits(amount, 18),
            });

            return {
              chainId,
              quote: quote.quote,
              calldata: quote.calldata,
              expectedOutput: quote.expectedOutput,
              gasEstimate: await client.estimateGas(/* ... */),
            };
          } catch (error) {
            console.warn(`Failed to get quote for chain ${chainId}:`, error);
            return null;
          }
        }),
    );

    const validQuotes = quotes.filter(
      (q): q is NonNullable<(typeof quotes)[0]> => q !== null,
    );
    if (validQuotes.length === 0) {
      throw new Error("Failed to get quotes from any chain");
    }

    const bestQuote = validQuotes.reduce((best, current) => {
      if (!best) return current;
      return current.expectedOutput > best.expectedOutput ? current : best;
    });

    return bestQuote;
  },
});
