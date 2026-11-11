import { getTypesForEIP712Domain, hashTypedData, type Hex, type TypedDataDefinition } from "viem";

const UINT256_MAX = 2n ** 256n - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVEN_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} contains unsupported fields`);
}
function quantity(value: unknown, label: string, max = UINT256_MAX): bigint {
  if (typeof value !== "bigint" && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) && !(typeof value === "number" && Number.isSafeInteger(value))) throw new Error(`${label} must be an exact nonnegative integer`);
  const amount = BigInt(value as bigint | string | number);
  if (amount < 0n || amount > max) throw new Error(`${label} is out of range`);
  return amount;
}
function safeInteger(value: unknown, label: string, positive = false): number {
  const result = Number(quantity(value, label, BigInt(Number.MAX_SAFE_INTEGER)));
  if (positive && result === 0) throw new Error(`${label} is required and must be a positive safe integer`);
  return result;
}
function hex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !EVEN_HEX.test(value)) throw new Error(`${label} must be even-length 0x hexadecimal bytes`);
  return value.toLowerCase() as Hex;
}
function address(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${label} must be an exact 20-byte address`);
  return value.toLowerCase() as Hex;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value) throw new Error(`${label} must be valid Unicode text`);
  return value;
}

type TypeField = { name: string; type: string };
/** Reject fields that viem would display but omit from the signed domain/struct. */
export function normalizeTypedData(value: unknown): TypedDataDefinition {
  const p = record(value, "Typed data");
  exactKeys(p, ["domain", "types", "primaryType", "message"], "Typed data");
  const rawDomain = record(p.domain, "Typed data domain");
  exactKeys(rawDomain, ["name", "version", "chainId", "verifyingContract", "salt"], "Typed data domain");
  const domain: Record<string, any> = {};
  for (const key of ["name", "version"]) {
    if (rawDomain[key] !== undefined) {
      if (typeof rawDomain[key] !== "string" || (key === "version" && rawDomain[key] === "")) throw new Error(`Invalid domain ${key}`);
      domain[key] = text(rawDomain[key], `Domain ${key}`);
    }
  }
  domain.chainId = safeInteger(rawDomain.chainId, "domain chainId", true);
  domain.verifyingContract = address(rawDomain.verifyingContract, "domain verifyingContract");
  if (rawDomain.salt !== undefined) {
    domain.salt = hex(rawDomain.salt, "domain salt");
    if (domain.salt.length !== 66) throw new Error("Domain salt must contain 32 bytes");
  }
  const inputTypes = record(p.types, "Typed data types");
  const types: Record<string, TypeField[]> = Object.create(null);
  for (const [name, fields] of Object.entries(inputTypes)) {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name) || !Array.isArray(fields) || fields.length > 128) throw new Error("Invalid typed data type");
    const names = new Set<string>();
    types[name] = fields.map(field => {
      const f = record(field, "Typed data field");
      exactKeys(f, ["name", "type"], "Typed data field");
      if (typeof f.name !== "string" || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(f.name) || ["__proto__", "constructor", "prototype"].includes(f.name) || names.has(f.name) || typeof f.type !== "string") throw new Error("Invalid or duplicate typed data field");
      names.add(f.name);
      return { name: f.name, type: f.type };
    });
  }
  const domainFields = getTypesForEIP712Domain({ domain });
  if (types.EIP712Domain && JSON.stringify(types.EIP712Domain) !== JSON.stringify(domainFields)) throw new Error("EIP712Domain must exactly match the canonical signed domain fields");
  types.EIP712Domain = domainFields;
  if (typeof p.primaryType !== "string" || p.primaryType === "EIP712Domain" || !Object.hasOwn(types, p.primaryType)) throw new Error("Invalid primaryType");
  const normalize = (type: string, input: unknown, depth: number): any => {
    if (depth > 32) throw new Error("Typed data nesting limit exceeded");
    const array = /^(.*)\[([0-9]*)\]$/.exec(type);
    if (array) {
      if (!Array.isArray(input) || input.length > 4096 || (array[2] !== "" && input.length !== Number(array[2]))) throw new Error("Invalid typed data array");
      return input.map(item => normalize(array[1], item, depth + 1));
    }
    if (Object.hasOwn(types, type)) {
      const obj = record(input, `Typed ${type}`);
      exactKeys(obj, types[type].map(f => f.name), `Typed ${type}`);
      return Object.fromEntries(types[type].map(field => [field.name, normalize(field.type, obj[field.name], depth + 1)]));
    }
    if (type === "address") return address(input, "Typed address");
    if (type === "bool") { if (typeof input !== "boolean") throw new Error("Invalid typed bool"); return input; }
    if (type === "string") return text(input, "Typed string");
    const bytes = /^bytes([0-9]*)$/.exec(type);
    if (bytes) {
      const result = hex(input, "Typed bytes");
      if (bytes[1] && (Number(bytes[1]) < 1 || Number(bytes[1]) > 32 || result.length !== 2 + Number(bytes[1]) * 2)) throw new Error("Invalid typed bytes length");
      return result;
    }
    const integer = /^(u?int)([0-9]*)$/.exec(type);
    if (integer) {
      const bits = integer[2] ? Number(integer[2]) : 256;
      if (bits < 8 || bits > 256 || bits % 8) throw new Error("Invalid typed integer width");
      if (typeof input !== "bigint" && !(typeof input === "number" && Number.isSafeInteger(input)) && !(typeof input === "string" && /^-?(0|[1-9][0-9]*)$/.test(input))) throw new Error("Invalid exact typed integer");
      const n = BigInt(input as string | number | bigint);
      const signed = integer[1] === "int";
      if (n < (signed ? -(2n ** BigInt(bits - 1)) : 0n) || n >= 2n ** BigInt(signed ? bits - 1 : bits)) throw new Error("Typed integer out of range");
      return n;
    }
    throw new Error(`Unsupported typed field type: ${type}`);
  };
  const result = { domain, types, primaryType: p.primaryType, message: normalize(p.primaryType, p.message, 0) } as unknown as TypedDataDefinition;
  hashTypedData(result);
  return result;
}
