import { byteHex, dynamicBytes } from "../utils/exact.js";

/** DNS wire format uses UTF8 byte lengths, including emoji and non-ASCII names. */
export function dnsEncode(name: string): Uint8Array {
  if (typeof name !== "string" || name.length > 1024) throw new Error("Oversized DNS name");
  const labels = name.split(".").map(label => {
    const bytes = new TextEncoder().encode(label);
    if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== label) throw new Error("Invalid Unicode DNS label");
    return bytes;
  });
  if (labels.some(label => !label.length || label.length > 63)) throw new Error("Empty or oversized DNS label");
  const size = labels.reduce((n, label) => n + 1 + label.length, 1);
  if (size > 255) throw new Error("Oversized DNS name");
  const encoded = new Uint8Array(size);
  let pos = 0;
  for (const label of labels) { encoded[pos++] = label.length; encoded.set(label, pos); pos += label.length; }
  return encoded;
}
export function readENSBytes(value: unknown) {
  const data = byteHex(value);
  if (data.length < 66) throw new Error("Short ENS response");
  const offset = BigInt("0x" + data.slice(2, 66)), bytes = dynamicBytes(data, offset, 32);
  if (offset !== 32n || 64 + Math.ceil((bytes.length - 2) / 2 / 32) * 32 !== (data.length - 2) / 2) throw new Error("Noncanonical ENS tail");
  return bytes;
}

/** ENS universal resolution permits uint8 byte lengths. Keep the installed viem encoder. */
export function validateENSName(name: string): void {
  if (typeof name !== "string" || name.length > 4096 || !name.length) throw new Error("Oversized or empty ENS name");
  const labels = name.split(".").map(label => new TextEncoder().encode(label));
  if (labels.some(label => !label.length || label.length > 255) || labels.reduce((n, label) => n + label.length + 1, 1) > 4096) throw new Error("Oversized or empty ENS label");
}
