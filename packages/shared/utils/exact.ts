import { z } from "zod";
import type { Hex } from "viem";

export const MAX_UINT256 = (1n << 256n) - 1n;
export function uint256(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 78 || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Expected exact decimal uint256 string");
  const n = BigInt(value);
  if (n > MAX_UINT256) throw new Error("uint256 overflow");
  return n;
}
export const quantitySchema = z.string().refine(v => { try { uint256(v); return true; } catch { return false; } }, "Exact uint256 required");
export const identityAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
export function precision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) throw new Error("Unknown token precision");
  return value;
}
export function parseExactUnits(value: string, decimals: number): bigint {
  precision(decimals);
  if (typeof value !== "string" || value.length > 335 || !/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(value)) throw new Error("Invalid ASCII decimal amount");
  const [whole, fraction = ""] = (value.startsWith(".") ? "0" + value : value).split(".");
  if (fraction.length > decimals) throw new Error("Excess precision; refusing rounding");
  const raw = (whole + fraction.padEnd(decimals, "0")).replace(/^0+(?=.)/, "");
  return uint256(raw);
}
export function byteHex(value: unknown, maxBytes = 65536): Hex {
  if (typeof value !== "string" || value.length > 2 + maxBytes * 2 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error("Malformed or oversized byte data");
  return value.toLowerCase() as Hex;
}
export function abiWord(value: unknown): bigint {
  const hex = byteHex(value, 32);
  if (hex.length !== 66) throw new Error("Unreadable ABI word; never zero");
  return BigInt(hex);
}
/** Bound an ABI tail before converting offsets to numbers or doing arithmetic. */
export function dynamicBytes(value: unknown, offset: bigint, headBytes: number): Hex {
  const hex = byteHex(value), bytes = BigInt((hex.length - 2) / 2);
  if (offset % 32n || offset < BigInt(headBytes) || offset > bytes || bytes - offset < 32n) throw new Error("Invalid dynamic offset");
  const start = 2 + Number(offset) * 2;
  const length = BigInt("0x" + hex.slice(start, start + 64));
  const available = bytes - offset - 32n;
  if (length > available || (length + 31n) / 32n * 32n > available) throw new Error("Invalid dynamic length");
  const end = start + 64 + Number(length) * 2;
  if (!/^0*$/.test(hex.slice(end, start + 64 + Number((length + 31n) / 32n * 32n) * 2))) throw new Error("Noncanonical padding");
  return ("0x" + hex.slice(start + 64, end)) as Hex;
}
