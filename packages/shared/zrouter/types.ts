import { Token } from "zrouter-sdk";
import z from "zod";
import { addressSchema } from "../utils.js";
import { quantitySchema } from "../utils/exact.js";
import { Address, isAddress } from "viem";

export type ResolvedToken = Token & { standard: "ERC20" | "ERC6909"; decimals: number; precisionSource: "contract" | "native-chain-unit" };

type TokenInput = {
  address: string; // raw input comes in as a string
  id?: bigint;
};

export const TokenSchema = z.object({
 address: z.string().transform((val, ctx) => {
   if (!isAddress(val)) {
     ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Ethereum address" });
     return z.NEVER;
   }
   return val as Address;
 }),
 id: quantitySchema.optional().transform((val) => val !== undefined ? BigInt(val) : undefined),
});

export type ZToken = z.infer<typeof TokenSchema>;

export const SymbolOrTokenSchema = z.union([z.string(), TokenSchema]);

export const AmountSchema = z.string().max(335);
