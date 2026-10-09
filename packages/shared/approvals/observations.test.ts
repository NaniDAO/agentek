import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, erc20Abi, keccak256, pad, toBytes } from "viem";
import type { AgentekClient } from "../client.js";
import { discoverTokenPermissionsTool } from "./discovery.js";
import { observeTokenPermissionTool, planSelectedRevocationsTool } from "./observations.js";

const owner = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";
const spender = "0x3333333333333333333333333333333333333333";
const args = { owner, token, spender, chainId: 1 };
const allowanceWord = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);

function fixture(data = allowanceWord(42n)) {
  const rpc = {
    getBlockNumber: vi.fn(async () => 100n),
    call: vi.fn(async () => ({ data })),
    request: vi.fn(async () => [{
      address: token,
      blockNumber: "0x64",
      data: allowanceWord(42n),
      topics: [keccak256(toBytes("Approval(address,address,uint256)")), pad(owner), pad(spender)],
    }]),
  };
  const getPublicClient = vi.fn(() => rpc);
  const executeOps = vi.fn(() => { throw new Error("Observation must not submit transactions"); });
  const client = { getPublicClient, executeOps } as unknown as AgentekClient;
  return { client, rpc, getPublicClient, executeOps };
}

describe("permission observations and unsigned revocation plans", () => {
  it("reads the selected owner/token/spender on the configured chain at a pinned block", async () => {
    const { client, rpc, getPublicClient, executeOps } = fixture();
    const result = await observeTokenPermissionTool.execute(client, args);
    expect(result).toMatchObject({ ...args, allowanceHex: allowanceWord(42n), active: true, unlimited: false, block: "0x64" });
    expect(getPublicClient).toHaveBeenCalledWith(1);
    expect(rpc.call).toHaveBeenCalledWith({
      to: token,
      data: expect.any(String),
      blockNumber: 100n,
    });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: rpc.call.mock.calls[0][0].data });
    expect(decoded).toMatchObject({ functionName: "allowance", args: [owner, spender] });
    expect(executeOps).not.toHaveBeenCalled();
  });

  it("rejects unreadable allowances instead of reporting zero", async () => {
    const { client } = fixture("0x" as `0x${string}`);
    await expect(observeTokenPermissionTool.execute(client, args)).rejects.toThrow("Unreadable ABI word");
  });

  it("discovers a historical pair and reads its current allowance for the supplied owner", async () => {
    const { client, rpc, executeOps } = fixture();
    const result = await discoverTokenPermissionsTool.execute(client, { owner, chainId: 1, through: 100 });
    expect(result.entries).toEqual([{
      pair: { token, spender },
      allowance: expect.objectContaining({ ...args, active: true, allowanceHex: allowanceWord(42n) }),
      error: null,
    }]);
    expect(rpc.call).toHaveBeenCalledOnce();
    expect(executeOps).not.toHaveBeenCalled();
  });

  it("keeps an unreadable discovered allowance unknown", async () => {
    const { client } = fixture("0x" as `0x${string}`);
    const result = await discoverTokenPermissionsTool.execute(client, { owner, chainId: 1 });
    expect(result.entries[0]).toMatchObject({ allowance: null, error: expect.stringContaining("not zero") });
  });

  it("prepares a zero-approval only for the selected active pair without submitting it", async () => {
    const { client, executeOps } = fixture();
    const result = await planSelectedRevocationsTool.execute(client, { owner, chainId: 1, pairs: [{ token, spender }] });
    expect(result.observations).toEqual([expect.objectContaining(args)]);
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]).toMatchObject({ target: token, value: "0" });
    expect(decodeFunctionData({ abi: erc20Abi, data: result.ops[0].data })).toMatchObject({
      functionName: "approve", args: [spender, 0n],
    });
    expect(executeOps).not.toHaveBeenCalled();
  });

  it("rejects a zero allowance instead of preparing a redundant revocation", async () => {
    const { client } = fixture(allowanceWord(0n));
    await expect(planSelectedRevocationsTool.execute(client, { owner, chainId: 1, pairs: [{ token, spender }] }))
      .rejects.toThrow("Selected allowance is zero");
  });

  it.each(["owner", "token", "spender", "chainId"])("keeps %s required in the public tool schema", (field) => {
    const incomplete = { ...args };
    delete incomplete[field];
    expect(observeTokenPermissionTool.parameters.safeParse(incomplete).success).toBe(false);
  });
});
