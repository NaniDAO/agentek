import { Address } from "viem";
import { z } from "zod";
import { isAddress } from "viem/utils";

export const addressSchema = z.string().transform((val, ctx) => {
  if (!isAddress(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid Ethereum address",
    });
    // stop here
    return z.NEVER;
  }
  return val as Address; // output is Address
});

export const clean = (obj: any): any => {
  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(clean);
  }

  if (typeof obj === "string") {
    return obj.trim();
  }

  if (obj && typeof obj === "object") {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = clean(obj[key]);
    }
    return newObj;
  }

  return obj;
};
