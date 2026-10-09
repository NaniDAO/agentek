import {
  createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseUnits, toHex,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  TOKEN, COUNTER, EXCHANGE, GYM_WALLET, SPENDER,
  tokenRuntime, counterRuntime, exchangeRuntime, balanceSlotKey, allowanceSlotKey,
} from "./runtime.mjs";

const url = process.env.FIXTURE_RPC_URL ?? "http://127.0.0.1:18545";
const rpc = async (method, params) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};
const client = createPublicClient({ chain: mainnet, transport: http(url) });
const wallet = createWalletClient({ chain: mainnet, transport: http(url),
  account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") });

await rpc("anvil_setCode", [TOKEN, tokenRuntime()]);
await rpc("anvil_setCode", [COUNTER, counterRuntime()]);
await rpc("anvil_setCode", [EXCHANGE, exchangeRuntime()]);
await rpc("anvil_setStorageAt", [TOKEN, balanceSlotKey(GYM_WALLET), toHex(parseUnits("1000", 6), { size: 32 })]);
await rpc("anvil_setStorageAt", [TOKEN, balanceSlotKey(EXCHANGE), toHex(parseUnits("1000", 6), { size: 32 })]);
await rpc("anvil_setStorageAt", [TOKEN, allowanceSlotKey(GYM_WALLET, SPENDER), toHex(parseUnits("1000", 6), { size: 32 })]);
await rpc("anvil_setStorageAt", [COUNTER, toHex(0, { size: 32 }), toHex(424242, { size: 32 })]);

const read = (functionName, args = []) => client.readContract({ address: TOKEN, abi: erc20Abi, functionName, args });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(await read("decimals") === 6, "Wrong decimals");
assert(await read("symbol") === "USDC", "Wrong symbol");
assert(await read("balanceOf", [GYM_WALLET]) === parseUnits("1000", 6), "Wrong initial balance");
assert(await read("allowance", [GYM_WALLET, SPENDER]) === parseUnits("1000", 6), "Wrong initial allowance");

const send = async (to, data, value = 0n) => {
  const hash = await wallet.sendTransaction({ to, data, value });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `Transaction reverted: ${hash}`);
};
await send(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SPENDER, parseUnits("500", 6)] }));
assert(await read("allowance", [GYM_WALLET, SPENDER]) === parseUnits("500", 6), "Approval failed");
await send(TOKEN, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [SPENDER, parseUnits("100", 6)] }));
assert(await read("balanceOf", [SPENDER]) === parseUnits("100", 6), "Transfer failed");
assert(await read("balanceOf", [GYM_WALLET]) === parseUnits("900", 6), "Sender debit failed");

const counterAbi = [
  { type: "function", name: "answer", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "increment", stateMutability: "nonpayable", inputs: [], outputs: [] },
];
assert(await client.readContract({ address: COUNTER, abi: counterAbi, functionName: "answer" }) === 424242n,
  "Counter read failed");
await send(COUNTER, encodeFunctionData({ abi: counterAbi, functionName: "increment" }));
assert(await client.readContract({ address: COUNTER, abi: counterAbi, functionName: "answer" }) === 424243n,
  "Counter write failed");

const swapAbi = [{ type: "function", name: "swap", stateMutability: "payable", inputs: [],
  outputs: [{ type: "bool" }] }];
await send(EXCHANGE, encodeFunctionData({ abi: swapAbi, functionName: "swap" }), 100000000000000000n);
assert(await read("balanceOf", [GYM_WALLET]) === parseUnits("1100", 6), "Swap output failed");
console.log("Synthetic ERC-20, allowance, contract view/write, and fixed-rate swap passed");
