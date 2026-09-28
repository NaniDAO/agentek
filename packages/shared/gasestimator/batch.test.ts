import { describe, it, expect } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { quoteNaniBatchTool } from "./batch.js";

const owner = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const implementation = "d54cb65224410f3ff97a8e72f363f224419f4fb0";
const args = { owner, chainId: 1, calls: [{ to: target, value: "0x20000000000001", data: "0x" }] };
function client(options: { upgrade?: boolean; initialized?: boolean; chain?: string; fail?: string } = {}) {
  return { getPublicClient: () => ({ request: async ({ method, params }: any) => {
    if (method === options.fail) throw new Error("RPC unavailable");
    switch (method) {
      case "eth_chainId": return options.chain ?? "0x1";
      case "eth_getCode": return params[0] === owner ? (options.upgrade ? "0x" : `0xef0100${implementation}`) : "0x60006000";
      case "eth_call": return options.initialized ? "0x1" : "0x0";
      case "eth_estimateGas": {
        expect(params[0].to).toBe(owner);
        if (options.upgrade) expect(params[2][owner].code).toBe("0x60006000");
        return "0x186a0";
      }
      case "eth_getBlockByNumber": return { baseFeePerGas: "0x64" };
      case "eth_maxPriorityFeePerGas": return "0x2";
      case "eth_getBalance": return "0xffffffffffffffffffff";
      default: throw new Error(`Unexpected RPC/signing operation: ${method}`);
    }
  } }) } as any;
}
describe("unsigned batch approval evidence", () => {
  it("quotes the whole batch and preserves values above Number precision", async () => {
    const result = await quoteNaniBatchTool.execute(client(), args);
    expect(result.totalValue).toBe(args.calls[0].value);
    expect(BigInt(result.maximumFee)).toBe(125000n * 202n);
    expect(result.addsDelegation).toBe(false);
    expect(result.additionalFeeKnown).toBe(true);
    const decoded = decodeFunctionData({ abi: parseAbi(["function batch(address[],uint256[],bytes[])"]), data: result.data });
    expect(decoded.args).toEqual([[target], [9007199254740993n], ["0x"]]);
  });
  it("includes initialization only for a new account and reserves authorization gas", async () => {
    for (const initialized of [false, true]) {
      const result = await quoteNaniBatchTool.execute(client({ upgrade: true, initialized }), args);
      const decoded = decodeFunctionData({ abi: parseAbi(["function batch(address[],uint256[],bytes[])"]), data: result.data });
      expect(result.addsDelegation).toBe(true);
      expect(result.initializesAccount).toBe(!initialized);
      expect(decoded.args![0].length).toBe(initialized ? 1 : 2);
      expect(BigInt(result.gasLimit)).toBe(156250n);
    }
  });
  it("fails closed on missing evidence and preserves unknown additional fees", async () => {
    await expect(quoteNaniBatchTool.execute(client({ chain: "0x2" }), args)).rejects.toThrow("network mismatch");
    for (const fail of ["eth_estimateGas", "eth_getBalance", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas"]) {
      await expect(quoteNaniBatchTool.execute(client({ fail }), args)).rejects.toThrow();
    }
    const rollup = await quoteNaniBatchTool.execute(client({ chain: "0x2105" }), { ...args, chainId: 8453 });
    expect(rollup.additionalFeeKnown).toBe(false);
  });
});
