import { z } from "zod";
import { createTool } from "../client.js";
import { quote } from "zrouter-sdk";
import { mainnet } from "viem/chains";
import { resolveInputToToken, toBaseUnits, asToken } from "./utils.js";
import { SymbolOrTokenSchema } from "./types.js";
import { supportedChains } from "./constants.js";
import { fetchApiRoutes } from "./api.js";

export const getQuote = createTool({
  name: "getQuote",
  description: "Get a price quote for swapping ERC20 or ERC6909 tokens via the zRouter. Returns expected output amount and routing info. Does not execute the swap.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().default(1).describe("Chain ID (1 for Mainnet, 8453 for Base). Default: 1"),
    tokenIn: SymbolOrTokenSchema.describe('Input token — either a symbol string (e.g. "USDT", "ETH") or an object { address, id? } for ERC6909 tokens'),
    tokenOut: SymbolOrTokenSchema.describe('Output token — either a symbol string (e.g. "IZO", "WETH") or an object { address, id? } for ERC6909 tokens'),
    amount: z.union([z.number(), z.string()]).describe("Amount in human-readable units (e.g. 1.5 or '1.5'). Refers to tokenIn for EXACT_IN, tokenOut for EXACT_OUT."),
    side: z.enum(["EXACT_IN", "EXACT_OUT"]).describe("EXACT_IN: specify the input amount and get the best output. EXACT_OUT: specify the desired output and get the required input."),
  }),
  execute: async (client, args) => {
    const { tokenIn, tokenOut, side } = args;
    const chainId = (args.chainId || mainnet.id) as 1 | 8453;
    const amountInput =
      typeof args.amount === "number" ? args.amount.toString() : args.amount;

    const publicClient = client.getPublicClient(chainId);

    // --- resolve tokens (symbol -> address[/id]) and decimals/standard ---
    const [tIn, tOut] = await Promise.all([
      resolveInputToToken(tokenIn, chainId),
      resolveInputToToken(tokenOut, chainId),
    ]);

    // --- parse amount into base units depending on standard ---
    const parsedAmount =
      side === "EXACT_IN"
        ? toBaseUnits(amountInput, tIn)
        : toBaseUnits(amountInput, tOut);

    // Try API first (includes Matcha/0x aggregated quotes alongside on-chain)
    const apiRoutes = await fetchApiRoutes({
      chainId,
      tokenIn: { address: tIn.address, ...(tIn.id !== undefined ? { id: tIn.id } : {}) },
      tokenOut: { address: tOut.address, ...(tOut.id !== undefined ? { id: tOut.id } : {}) },
      side,
      amount: parsedAmount,
      owner: "0x0000000000000000000000000000000000010000",
    });

    if (apiRoutes && apiRoutes.length > 0) {
      const best = apiRoutes[0];
      return {
        expectedAmount: best.expectedAmount,
        venue: best.venue,
        sources: best.metadata.sources,
        routeCount: apiRoutes.length,
        source: "api" as const,
      };
    }

    // Fallback to SDK quote (fully on-chain, no API key needed)
    const q = await quote(publicClient, {
      tokenIn: asToken(tIn),
      tokenOut: asToken(tOut),
      amount: parsedAmount,
      side,
    });

    return q;
  },
});
