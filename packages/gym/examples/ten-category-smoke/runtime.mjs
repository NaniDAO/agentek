import { encodeAbiParameters, keccak256, padHex, stringToHex, toHex } from "viem";

export const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const COUNTER = "0x1000000000000000000000000000000000000001";
export const EXCHANGE = "0x1000000000000000000000000000000000000002";
export const ORIGIN_SPOKE = "0x2000000000000000000000000000000000000001";
export const DESTINATION_SPOKE = "0x2000000000000000000000000000000000000002";
export const OUTPUT_TOKEN = "0x3000000000000000000000000000000000000002";
export const BRIDGE_RECIPIENT = "0x4000000000000000000000000000000000000001";
export const GYM_WALLET = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
export const SPENDER = "0x5000000000000000000000000000000000000001";

const selector = (signature) => keccak256(stringToHex(signature)).slice(2, 10);

class Assembly {
  bytes = [];
  labels = new Map();
  fixups = [];

  op(byte) { this.bytes.push(byte); return this; }
  push(value, width = 1) {
    const big = BigInt(value);
    if (big < 0n || big >= 1n << BigInt(width * 8)) throw new Error("Invalid PUSH operand");
    this.op(0x5f + width);
    for (let i = width - 1; i >= 0; i -= 1) this.op(Number((big >> BigInt(i * 8)) & 255n));
    return this;
  }
  label(name) { this.labels.set(name, this.bytes.length); return this.op(0x5b); }
  target(name) {
    this.op(0x61); // PUSH2; supports runtimes up to 64 KiB.
    this.fixups.push([this.bytes.length, name]);
    this.op(0).op(0);
    return this;
  }
  jump(name) { return this.target(name).op(0x56); }
  jumpIf(name) { return this.target(name).op(0x57); }
  finish() {
    for (const [at, name] of this.fixups) {
      const position = this.labels.get(name);
      if (position === undefined) throw new Error(`Unknown label ${name}`);
      this.bytes[at] = position >> 8;
      this.bytes[at + 1] = position & 255;
    }
    return `0x${this.bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
}

const readArg = (code, offset) => code.push(offset).op(0x35);
const store = (code, offset) => code.push(offset).op(0x52);
const returnWord = (code) => code.push(0).op(0x52).push(32).push(0).op(0xf3);
const mappingKey = (code, accountSource, slot) => {
  accountSource(code);
  store(code, 0);
  code.push(slot);
  store(code, 32);
  code.push(64).push(0).op(0x20);
};
const allowanceKey = (code, ownerSource) => {
  mappingKey(code, ownerSource, 4);
  store(code, 32);
  readArg(code, 4);
  store(code, 0);
  code.push(64).push(0).op(0x20);
};
const dispatch = (code, functions) => {
  code.push(0).op(0x35).push(224).op(0x1c);
  for (const [signature, label] of functions) {
    code.op(0x80).push(`0x${selector(signature)}`, 4).op(0x14).jumpIf(label);
  }
  code.push(0).push(0).op(0xfd);
};

export function tokenRuntime() {
  const c = new Assembly();
  dispatch(c, [
    ["decimals()", "decimals"], ["symbol()", "symbol"],
    ["balanceOf(address)", "balance"], ["allowance(address,address)", "allowance"],
    ["approve(address,uint256)", "approve"], ["transfer(address,uint256)", "transfer"],
  ]);
  c.label("decimals").op(0x50).push(6); returnWord(c);
  c.label("symbol").op(0x50).push(32); store(c, 0);
  c.push(4); store(c, 32);
  c.push(0x55534443, 4).push(224).op(0x1b); store(c, 64); // "USDC"
  c.push(96).push(0).op(0xf3);
  c.label("balance").op(0x50);
  mappingKey(c, (x) => readArg(x, 4), 3);
  c.op(0x54); returnWord(c);
  c.label("allowance").op(0x50);
  mappingKey(c, (x) => readArg(x, 4), 4);
  store(c, 32); readArg(c, 36); store(c, 0);
  c.push(64).push(0).op(0x20).op(0x54); returnWord(c);
  c.label("approve").op(0x50);
  allowanceKey(c, (x) => x.op(0x33));
  readArg(c, 36); c.op(0x90).op(0x55);
  c.push(1); returnWord(c);
  c.label("transfer").op(0x50);
  mappingKey(c, (x) => x.op(0x33), 3);
  c.op(0x80).op(0x54); // key, balance
  readArg(c, 36); // key, balance, amount
  c.op(0x80).op(0x82).op(0x10).jumpIf("revert"); // balance < amount
  c.op(0x90).op(0x03).op(0x90).op(0x55); // sender balance -= amount
  mappingKey(c, (x) => readArg(x, 4), 3);
  c.op(0x80).op(0x54); readArg(c, 36);
  c.op(0x01).op(0x90).op(0x55); // recipient balance += amount
  c.push(1); returnWord(c);
  c.label("revert").push(0).push(0).op(0xfd);
  return c.finish();
}

export function counterRuntime() {
  const c = new Assembly();
  dispatch(c, [["answer()", "answer"], ["increment()", "increment"]]);
  c.label("answer").op(0x50).push(0).op(0x54); returnWord(c);
  c.label("increment").op(0x50).push(0).op(0x54).push(1).op(0x01).push(0).op(0x55);
  c.push(0); returnWord(c);
  return c.finish();
}

export function exchangeRuntime() {
  const c = new Assembly();
  dispatch(c, [["swap()", "swap"]]);
  c.label("swap").op(0x50).op(0x34).push(100000000000000000n, 8).op(0x14).op(0x15)
    .jumpIf("revert");
  c.push(`0x${selector("transfer(address,uint256)")}`, 4).push(224).op(0x1b); store(c, 0);
  c.op(0x33); store(c, 4);
  c.push(200000000n, 4); store(c, 36);
  c.push(32).push(0).push(68).push(0).push(0).push(TOKEN, 20).op(0x5a).op(0xf1);
  c.op(0x15).jumpIf("revert");
  c.push(1); returnWord(c);
  c.label("revert").push(0).push(0).op(0xfd);
  return c.finish();
}

const word = (value) => typeof value === "bigint"
  ? toHex(value, { size: 32 }).slice(2)
  : padHex(value, { size: 32 }).slice(2);

export function bridgeEmitterRuntime() {
  const data = encodeAbiParameters(
    [
      { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
      { type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "address" },
      { type: "address" }, { type: "bytes" },
    ],
    [TOKEN, OUTPUT_TOKEN, 1000000n, 990000n, 1, 4294967295, 0,
      BRIDGE_RECIPIENT, GYM_WALLET, "0x"],
  ).slice(2);
  const topic0 = keccak256(stringToHex(
    "V3FundsDeposited(address,address,uint256,uint256,uint256,uint32,uint32,uint32,uint32,address,address,address,bytes)",
  ));
  const dataLength = data.length / 2;
  const push2 = (value) => value.toString(16).padStart(4, "0");
  return `0x${[
    `61${push2(dataLength)}61${push2(148)}600039`,
    `7f${word(GYM_WALLET)}`, `7f${word(7n)}`, `7f${word(8453n)}`,
    `7f${topic0.slice(2)}`, `61${push2(dataLength)}6000a400`, data,
  ].join("")}`;
}

export function balanceSlotKey(account) {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }], [account, 3n],
  ));
}

export function allowanceSlotKey(owner, spender) {
  const ownerSlot = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }], [owner, 4n],
  ));
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }], [spender, BigInt(ownerSlot)],
  ));
}
