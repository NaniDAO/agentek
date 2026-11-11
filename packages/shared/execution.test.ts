import { afterEach, describe, expect, it, vi } from "vitest";
import { custom, http, keccak256, recoverMessageAddress, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAgentekClient, TransactionExecutionError } from "./client.js";
import { intentTransferTool, intentTransferFromTool } from "./transfer/intents.js";
import { intentAaveDeposit } from "./aave/intents.js";
import { decodeFunctionData, erc20Abi } from "viem";
import { getPoolFeeData, getUserPositions } from "./uniV3/tools.js";

const owner = "0x1111111111111111111111111111111111111111", token = "0x2222222222222222222222222222222222222222";
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const op = {target: owner, value: "1", data: "0x"} as const;
const makeClient = (extra = {}) => createAgentekClient({chains: [mainnet], transports: [http()], accountOrAddress: account, tools: [], executionMode: "execute", authorizeAction: () => true, ...extra});
afterEach(() => vi.restoreAllMocks());

describe("transaction failure and signature contracts", () => {
  it("uses the local account for personal signing without an RPC signing request", async () => {
    const request = vi.fn(async () => { throw new Error("RPC signing forbidden"); });
    const client = makeClient({transports: [custom({request})]});
    const [signature] = await client.executeSign([{type: "personal_sign", message: "local control"}], 1);
    expect(await recoverMessageAddress({message: "local control", signature: signature as Hex})).toBe(account.address);
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves requested mixed-operation order and rejects unknown operations before effects", async () => {
    const client = makeClient(), order: string[] = [];
    vi.spyOn(client, "executeOps").mockImplementation(async () => {order.push("transaction"); return "hash";});
    vi.spyOn(client, "executeSign").mockImplementation(async () => {order.push("signature"); return ["sig"];});
    await client.executeOperations([{type: "personal_sign", message: "hello"}, op, {type: "personal_sign", message: "end"}], 1);
    expect(order).toEqual(["signature", "transaction", "signature"]);
    order.length = 0;
    await expect(client.executeOperations([op, {type: "unexpected"} as any], 1)).rejects.toThrow(/Unsupported/);
    expect(order).toEqual([]);
  });
  it("persists hashes before broadcast, keeps partial progress and stops after an ambiguous send", async () => {
    const saved: any[] = [], client = makeClient({onExecutionUpdated: async record => {saved.push(record);}});
    let signed = 0;
    const wallet = client.getWalletClient(1) as any, rpc = client.getPublicClient(1) as any;
    wallet.prepareTransactionRequest = vi.fn(async tx => tx);
    wallet.signTransaction = vi.fn(async () => (++signed === 1 ? "0x01" : "0x02"));
    rpc.sendRawTransaction = vi.fn(async ({serializedTransaction}) => {
      expect(saved.at(-1).operations[signed-1]).toMatchObject({hash: keccak256(serializedTransaction), status: "unknown"});
      if (signed === 2) throw new Error("Connection lost after acceptance");
      return keccak256(serializedTransaction);
    });
    rpc.waitForTransactionReceipt = vi.fn(async () => ({status: "success"}));
    const error = await client.executeOps([op, op, op], 1).catch(error => error);
    expect(error).toBeInstanceOf(TransactionExecutionError);
    expect(error.execution.status).toBe("unknown");
    expect(error.execution.operations.map(op => op.status)).toEqual(["confirmed", "unknown", "prepared"]);
    expect(error.execution.operations[1].hash).toBe(keccak256("0x02"));
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    await expect(client.executeOps([op], 1)).rejects.toThrow(/reconcile/i);
  });
  it("prepare mode cannot submit even when a private key is configured", async () => {
    const client = makeClient({executionMode: "prepare"});
    expect(client.getWalletClient(1)).toBeUndefined();
    await expect(client.executeOps([op], 1)).rejects.toThrow(/prepare/);
  });
});

describe("exact amounts and honest observations", () => {
  const rpc: any = {readContract: vi.fn(), getBalance: async () => 1000000000000000000n, estimateGas: async () => 21000n, estimateFeesPerGas: async () => ({gasPrice: 1n})};
  const client: any = {filterSupportedChains: () => [mainnet], getPublicClient: () => rpc, getAddress: async () => owner, getWalletClient: () => undefined};
  it("rejects fractional raw token units and insufficient transferFrom allowances", async () => {
    rpc.readContract.mockImplementation(async ({functionName}) => functionName === "decimals" ? 6 : functionName === "allowance" ? 0n : 1000000000n);
    await expect(intentTransferTool.execute(client, {token, amount: "0.0000001", to: owner, chainId: 1})).rejects.toThrow(/precision/);
    await expect(intentTransferFromTool.execute(client, {token, from: token, amount: "1", to: owner, chainId: 1})).rejects.toThrow(/allowance/);
    const result = await intentTransferTool.execute(client, {token, amount: "1.000001", to: owner, chainId: 1});
    expect(decodeFunctionData({abi: erc20Abi, data: result.ops[0].data}).args?.[1]).toBe(1000001n);
  });
  it("reserves native gas instead of preparing a full-balance transfer", async () => {
    await expect(intentTransferTool.execute(client, {token: `0x${"0".repeat(40)}`, amount: "1", to: token, chainId: 1})).rejects.toThrow(/gas reserve/);
  });
  it("resets a nonzero Aave allowance and approves only the requested amount", async () => {
    rpc.readContract.mockImplementation(async ({functionName}) => functionName === "decimals" ? 6 : 1n);
    const result = await intentAaveDeposit.execute(client, {chainId: 1, asset: token, amount: "2"});
    expect(result.ops).toHaveLength(3);
    expect(decodeFunctionData({abi: erc20Abi, data: result.ops[0].data}).args?.[1]).toBe(0n);
    expect(decodeFunctionData({abi: erc20Abi, data: result.ops[1].data}).args?.[1]).toBe(2000000n);
  });
  it("does not convert failed LP fee reads into zero balances", async () => {
    const broken: any = {getPublicClient: () => ({multicall: async () => [{status: "failure"}, {status: "success", result: 0n}, {status: "success", result: [0n,0n]}]})};
    await expect(getPoolFeeData.execute(broken, {chainId: 1, poolAddress: token})).rejects.toThrow(/unavailable/);
  });
  it("pages LP positions with a bounded number of RPC reads", async () => {
    const readContract = vi.fn(async ({functionName, args}) => functionName === "balanceOf" ? 1000000000n : functionName === "tokenOfOwnerByIndex" ? args[1] : [0,0,token,owner,3000,0,1,1n,0,0,0n,0n]);
    const header = { number: 100n, hash: `0x${"a".repeat(64)}`, timestamp: BigInt(Math.floor(Date.now() / 1000)) };
    const result = await getUserPositions.execute({getPublicClient: () => ({readContract, getChainId: async () => 1, getBlock: async () => header}), getAddress: async () => owner} as any, {chainId: 1, offset: 5, limit: 2});
    expect(result.nextOffset).toBe(7); expect(result.positions.map(p => p.tokenId)).toEqual(["5", "6"]);
    expect(readContract).toHaveBeenCalledTimes(5);
  });
});

it("normalizes bigint results at the shared adapter boundary", async () => {
  const client = makeClient({tools: [{name: "integer", description: "Return exact integer", parameters: (await import("zod")).z.object({}), execute: async () => ({balance: 900719925474099312345n})}]});
  expect(await client.execute("integer", {})).toEqual({balance: "900719925474099312345"});
});

it("retains completed signatures when a later mixed operation fails", async () => {
  const client = makeClient();
  vi.spyOn(client, "executeSign").mockResolvedValue(["signed"]);
  vi.spyOn(client, "executeOps").mockRejectedValue(new Error("Rejected before broadcast"));
  const error = await client.executeOperations([{type: "personal_sign", message: "hello"}, op], 1).catch(error => error);
  expect(error.retryable).toBe(false);
  expect(error.completed).toEqual([{index: 0, signatures: ["signed"]}]); expect(error.failedIndex).toBe(1);
});
