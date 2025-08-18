import { z } from "zod";
import { createTool } from "../client.js";
import { quote } from "zrouter-sdk";
import { mainnet } from "viem/chains";
import { resolveInputToToken, toBaseUnits } from "./utils.js";
import { SymbolOrTokenSchema } from "./types.js";

export const getQuote = createTool({
  name: "getQuote",
  description: "Get a quote for swapping ERC20 and ERC6909 tokens.",
  parameters: z.object({
    tokenIn: SymbolOrTokenSchema,
    tokenOut: SymbolOrTokenSchema,
    amount: z.union([z.number(), z.string()]),
    side: z.enum(["EXACT_IN", "EXACT_OUT"]),
  }),
  execute: async (client, args) => {
    const { tokenIn, tokenOut, side } = args;
    const amountInput =
      typeof args.amount === "number" ? args.amount.toString() : args.amount;

    const publicClient = client.getPublicClient(mainnet.id);

    // --- resolve tokens (symbol -> address[/id]) and decimals/standard ---
    const [tIn, tOut] = await Promise.all([
      resolveInputToToken(tokenIn, mainnet.id),
      resolveInputToToken(tokenOut, mainnet.id),
    ]);

    // --- parse amount into base units depending on standard ---
    const parsedAmount =
      side === "EXACT_IN" // parsing is same regardless of side; branch kept for clarity/extension
        ? toBaseUnits(amountInput, tIn)
        : toBaseUnits(amountInput, tOut);

    const q = await quote(publicClient, {
      tokenIn: { address: tIn.address, ...(tIn.id !== undefined ? { id: tIn.id } : {}) },
      tokenOut: { address: tOut.address, ...(tOut.id !== undefined ? { id: tOut.id } : {}) },
      amount: parsedAmount,
      side,
    });

    return q;
  },
});
