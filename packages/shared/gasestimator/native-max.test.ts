import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { quoteNaniNativeMaxTool as tool, nativeMaxOutput } from "./native-max.js";
import { implementation } from "./batch.js";
const owner = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const args = { owner, recipient, chainId: 1, calldata: "0x", purpose: "transfer", executionMode: "direct" };
const hex = (n: bigint) => `0x${n.toString(16)}`;
function fixture(options: { gas?: bigint; balance?: bigint; code?: string; chain?: string; fail?: string; malformed?: string; change?: string; valueDependent?: boolean; oscillate?: boolean; expire?: boolean } = {}) {
  const methods: string[] = [], estimates: any[] = [];
  let snapshots = 0;
  const client = { getPublicClient: () => ({ request: async ({ method, params }: any) => {
    methods.push(method);
    if (method === options.fail) throw new Error("offline failure");
    if (method === options.malformed) return "9007199254740993";
    switch (method) {
      case "eth_chainId": snapshots++; return options.chain ?? (options.change === method && snapshots > 1 ? "0x2" : "0x1");
      case "eth_blockNumber": return options.change === method && snapshots > 1 ? "0x11" : "0x10";
      case "eth_getTransactionCount": return options.change === method && snapshots > 1 ? "0x2" : "0x1";
      case "eth_getBalance": return hex(options.change === method && snapshots > 1 ? 5n : options.balance ?? 900719925474099312345n);
      case "eth_getCode": return params[0] === owner ? (options.change === method && snapshots > 1 ? "0x6000" : options.code ?? "0x") : "0x60006000";
      case "eth_call": return "0x0";
      case "eth_getBlockByNumber": return { baseFeePerGas: "0x64", number: options.change === method && snapshots > 1 ? "0x11" : "0x10", hash: `0x${(options.change === "blockHash" && snapshots > 1 ? "b" : "a").repeat(64)}` };
      case "eth_maxPriorityFeePerGas": return "0x2";
      case "eth_estimateGas": {
        estimates.push(params[0]);
        if (options.expire) vi.setSystemTime(Date.now() + 121000);
        if (options.oscillate) return estimates.length % 2 ? "0x5208" : "0x7530";
        const high = options.valueDependent && params[0].value !== "0x0";
        return hex(high ? 50000n : options.gas ?? 21000n);
      }
      default: throw new Error(`Forbidden RPC: ${method}`);
    }
  } }), getWalletClient: () => { throw new Error("Forbidden wallet access"); } } as any;
  return { client, methods, estimates };
}
async function quote(options: Parameters<typeof fixture>[0] = {}, overrides: any = {}) {
  const f = fixture(options);
  const result = await tool.execute(f.client, { ...args, ...overrides });
  expect(nativeMaxOutput.safeParse(result).success).toBe(true);
  expect(f.methods.every(m => ["eth_chainId", "eth_blockNumber", "eth_getTransactionCount", "eth_getBalance", "eth_getCode", "eth_call", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas", "eth_estimateGas"].includes(m))).toBe(true);
  return { ...f, result };
}
describe("native Max offline fee evidence", () => {
  const fetchGuard = vi.fn(() => { throw new Error("External network forbidden"); });
  beforeEach(() => { fetchGuard.mockClear(); vi.stubGlobal("fetch", fetchGuard); });
  afterEach(() => { expect(fetchGuard).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  it("reserves buffered gas at fee cap and preserves exact values above Number precision", async () => {
    const { result, estimates } = await quote();
    expect(result.availability).toBe("available");
    expect(result.fees.totalFeeCap).toBe("5302500");
    expect(result.spendable).toBe((900719925474099312345n - 5302500n).toString());
    expect(result.transaction.value).toBe(result.spendable);
    expect(estimates.at(-1).value).toBe(hex(BigInt(result.spendable)));
    expect(result.identity.nonce).toBe("1");
    expect(result.expiresAt - result.observedAt).toBe(120);
  });
  it("estimates a recipient above 21000 gas and reconverges for value-dependent execution", async () => {
    const { result, estimates } = await quote({ valueDependent: true });
    expect(result.fees.gasLimit).toBe("62500");
    expect(estimates.length).toBe(3);
    expect(result.spendable).toBe((BigInt(result.balance) - 62500n * 202n).toString());
  });
  it("uses existing Nani batch logic for delegated accounts and unsigned delegation/init", async () => {
    for (const code of [`0xef0100${implementation.slice(2)}`, "0x"]) {
      const { result } = await quote({ code, gas: 100000n }, { executionMode: "nani-batch" });
      expect(result.availability).toBe("available");
      expect(result.addsDelegation).toBe(code === "0x");
      expect(result.initializesAccount).toBe(code === "0x");
      expect(result.fees.gasLimit).toBe(code === "0x" ? "156250" : "125000");
      const decoded = decodeFunctionData({ abi: parseAbi(["function batch(address[],uint256[],bytes[])"]), data: result.transaction.data });
      expect(decoded.args![0].at(-1)).toBe(recipient);
      expect(decoded.args![1].at(-1)).toBe(BigInt(result.spendable));
      expect(result.transaction.value).toBe("0");
    }
  });
  it("rejects direct delegated accounts and unknown smart-account implementations", async () => {
    expect((await quote({ code: `0xef0100${implementation.slice(2)}` })).result.reason).toBe("ACCOUNT_MODE_MISMATCH");
    expect((await quote({ code: "0x6000" }, { executionMode: "nani-batch" })).result.reason).toBe("ACCOUNT_MODE_MISMATCH");
  });
  it("never assumes L2 data/operator fees are zero, even when caller requests direct mode", async () => {
    for (const chainId of [8453, 84532, 10, 42161, 4663]) {
      const { result, methods } = await quote({}, { chainId });
      expect(result.reason).toBe("ADDITIONAL_FEE_UNKNOWN");
      expect(result.spendable).toBeNull(); expect(result.fees).toBeNull(); expect(methods).toEqual([]);
    }
  });
  it("distinguishes insufficient balance from exactly zero spendable", async () => {
    expect((await quote({ balance: 5302499n })).result.reason).toBe("INSUFFICIENT_BALANCE");
    const { result } = await quote({ balance: 5302500n });
    expect(result.reason).toBe("ZERO_SPENDABLE"); expect(result.spendable).toBe("0");
  });
  it("fails closed on failed/malformed evidence, identity changes, and nonconvergence", async () => {
    for (const method of ["eth_estimateGas", "eth_getBalance", "eth_getBlockByNumber", "eth_maxPriorityFeePerGas", "eth_getCode", "eth_getTransactionCount"]) {
      expect((await quote({ fail: method })).result.reason).toBe("ESTIMATE_UNAVAILABLE");
      expect((await quote({ malformed: method })).result.reason).toBe("ESTIMATE_UNAVAILABLE");
    }
    expect((await quote({ chain: "0x2" })).result.reason).toBe("IDENTITY_CHANGED");
    for (const change of ["eth_chainId", "eth_getBlockByNumber", "blockHash", "eth_getBalance", "eth_getCode", "eth_getTransactionCount"])
      expect((await quote({ change })).result.reason).toBe("IDENTITY_CHANGED");
    expect((await quote({ gas: 0n })).result.reason).toBe("ESTIMATE_UNAVAILABLE");
    expect((await quote({ gas: 12000001n })).result.reason).toBe("ESTIMATE_UNAVAILABLE");
    expect((await quote({ oscillate: true })).result.reason).toBe("ESTIMATE_NOT_CONVERGED");
  });
  it("expires slow estimates", async () => {
    vi.useFakeTimers();
    try { expect((await quote({ expire: true })).result.reason).toBe("EXPIRED"); }
    finally { vi.useRealTimers(); }
  });
  it("rejects route substitution and non-transfer calldata without RPC access", async () => {
    for (const purpose of ["swap", "bridge"]) expect((await quote({}, { purpose })).result.reason).toBe("ROUTE_REQUIRES_QUOTE");
    expect((await quote({}, { calldata: "0x1234" })).result.reason).toBe("INVALID_INPUT");
    expect((await quote({}, { chainId: 999 })).result.reason).toBe("UNSUPPORTED_NETWORK");
  });
  it("binds recipient, mode and transaction quantities to distinct local digests", async () => {
    const a = (await quote()).result;
    const b = (await quote({}, { recipient: "0x3333333333333333333333333333333333333333" })).result;
    const c = (await quote({}, { executionMode: "nani-batch" })).result;
    expect(a.transactionId).not.toBe(b.transactionId); expect(a.transactionId).not.toBe(c.transactionId);
  });
});
