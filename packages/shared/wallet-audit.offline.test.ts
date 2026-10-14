import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
import { zRouterAbi } from "zrouter-sdk";
import { parseExactUnits, uint256, MAX_UINT256, dynamicBytes } from "./utils/exact.js";
import { dnsEncode, readENSBytes } from "./ens/bounds.js";
import { decodeBuiltSwap, ZROUTER_ADDRESS } from "./zrouter/zquoter.js";
import { buildNativeSwapProposal, deliverSwap, exactSwapOps, swapRequestSchema, validateSwapCall, validateSwapOps, type SwapRequest } from "./zrouter/proposal.js";
import { deserializeRoutes } from "./zrouter/api.js";
import { intentSwap } from "./zrouter/intents.js";
import { resolveInputToToken } from "./zrouter/utils.js";
import { createMatchSwapTool } from "./swap/intents.js";
import { observeAsset } from "./erc20/observations.js";
import { observeGuardianQueue } from "./nani/queue.js";
import { implementation } from "./gasestimator/batch.js";

const owner = "0x" + "1".repeat(40), sell = "0x" + "2".repeat(40), buy = "0x" + "3".repeat(40), zero = "0x" + "0".repeat(40);
const blockHash = "0x" + "a".repeat(64);
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const scalar = (n: bigint) => ("0x" + word(n)) as Hex;
const request = (mode: "EXACT_IN" | "EXACT_OUT" = "EXACT_IN", native = false): SwapRequest => ({ schemaVersion: 1, requestId: "fixture", owner, chainId: 1, recipient: owner,
  sellAsset: { address: native ? zero : sell, id: "0" }, buyAsset: { address: buy, id: "0" }, mode, amountRaw: "900719925474099312345678901", boundRaw: "800719925474099312345678901", deadline: String(Math.floor(Date.now() / 1000) + 1200), slippageBps: 50, source: "zquoter" });
function call(r: SwapRequest, name = "swapV2") {
  const args: any[] = [r.recipient, r.mode === "EXACT_OUT"];
  if (name === "swapV3" || name === "swapV4") args.push(3000);
  if (name === "swapV4") args.push(-60);
  if (name === "swapVZ") args.push(30n);
  args.push(r.sellAsset.address, r.buyAsset.address);
  if (name === "swapVZ") args.push(BigInt(r.sellAsset.id), BigInt(r.buyAsset.id));
  args.push(BigInt(r.amountRaw), BigInt(r.boundRaw), BigInt(r.deadline));
  return { target: ZROUTER_ADDRESS[r.chainId].toLowerCase(), value: r.sellAsset.address === zero ? r.mode === "EXACT_IN" ? r.amountRaw : r.boundRaw : "0",
    data: encodeFunctionData({ abi: zRouterAbi, functionName: name, args } as any) };
}
function built(r: SwapRequest, data = call(r).data) {
  return encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }, { type: "uint256" }],
    [0, 30n, BigInt(r.mode === "EXACT_IN" ? r.amountRaw : r.boundRaw), BigInt(r.mode === "EXACT_IN" ? r.boundRaw : r.amountRaw), data, BigInt(r.boundRaw), BigInt(call(r).value)]);
}
function fixture(r = request()) {
  const rpc: any = { chain: { id: r.chainId }, getChainId: vi.fn(async () => r.chainId), getBlock: vi.fn(async () => ({ number: 100n, hash: blockHash, timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
    call: vi.fn(async () => ({ data: built(r) })), readContract: vi.fn(async () => 18), getCode: vi.fn(async () => `0xef0100${implementation.slice(2)}`),
    getBalance: vi.fn(async () => MAX_UINT256), request: vi.fn(async () => []), getTransaction: vi.fn(async () => { throw new Error("Unknown transaction"); }) };
  const client: any = { getAddress: vi.fn(async () => owner), getPublicClient: vi.fn(() => rpc), getWalletClient: vi.fn(() => { throw new Error("Signing access forbidden"); }), executeOps: vi.fn(() => { throw new Error("Broadcast forbidden"); }) };
  return { client, rpc };
}
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fixed ABI economic commitments", () => {
  for (const abi of ["swapV2", "swapV3", "swapV4", "swapVZ"]) for (const mode of ["EXACT_IN", "EXACT_OUT"] as const) for (const native of [false, true]) {
    it(`${abi} ${mode} ${native ? "native" : "ERC20"}: legitimate exact batch and independent mutations`, () => {
      const r = request(mode, native), swap = call(r, abi), proposal = exactSwapOps(r, swap);
      expect(validateSwapOps(r, proposal.ops)).toEqual(proposal);
      expect(proposal.execution.maximumInputRaw).toBe(mode === "EXACT_IN" ? r.amountRaw : r.boundRaw);
      const assetIndex = abi === "swapV2" ? 2 : abi === "swapV4" ? 4 : 3;
      const amountIndex = abi === "swapV2" ? 4 : abi === "swapV3" ? 5 : abi === "swapV4" ? 6 : 7;
      for (const index of [0, 1, assetIndex, assetIndex + 1, amountIndex, amountIndex + 1, amountIndex + 2]) {
        const old = BigInt("0x" + swap.data.slice(10 + index * 64, 74 + index * 64));
        const data = (swap.data.slice(0, 10 + index * 64) + word(old + 1n) + swap.data.slice(74 + index * 64)) as Hex;
        expect(() => validateSwapCall(r, { ...swap, data })).toThrow();
      }
      expect(() => validateSwapCall(r, { ...swap, value: String(BigInt(swap.value) + 1n) })).toThrow();
      expect(() => validateSwapCall(r, { ...swap, target: buy })).toThrow();
      expect(() => validateSwapCall(r, { ...swap, data: (swap.data + "00") as Hex })).toThrow();
      expect(() => validateSwapOps(r, [...proposal.ops, proposal.ops[0]])).toThrow();
      for (const field of ["target", "value", "data"] as const) {
        const altered = proposal.ops.map(o => ({ ...o }));
        altered[0][field] = field === "target" ? buy : field === "value" ? "1" : "0x";
        expect(() => validateSwapOps(r, altered)).toThrow();
      }
      if (!native) {
        const changedSpender = proposal.ops.map(o => ({ ...o }));
        changedSpender[0].data = ("0x095ea7b3" + "0".repeat(24) + buy.slice(2) + word(BigInt(proposal.execution.maximumInputRaw))) as Hex;
        expect(() => validateSwapOps(r, changedSpender)).toThrow();
        const changedAmount = proposal.ops.map(o => ({ ...o }));
        changedAmount[0].data = (changedAmount[0].data.slice(0, -64) + word(MAX_UINT256)) as Hex;
        expect(() => validateSwapOps(r, changedAmount)).toThrow();
      }
      if (abi === "swapVZ") for (const index of [5, 6]) {
        const data = (swap.data.slice(0, 10 + index * 64) + word(1n) + swap.data.slice(74 + index * 64)) as Hex;
        expect(() => validateSwapCall(r, { ...swap, data })).toThrow();
      }
    });
  }
  it("rejects dirty address padding, bools, unsigned fee overflow and signed int24 overflow", () => {
    const r = request();
    for (const [abi, index, value] of [["swapV2", 0, 1n << 200n], ["swapV2", 1, 2n], ["swapV3", 2, 1n << 24n], ["swapV4", 3, 1n << 23n], ["swapVZ", 2, 1n << 160n]] as const) {
      const op = call(r, abi), data = (op.data.slice(0, 10 + index * 64) + word(value) + op.data.slice(74 + index * 64)) as Hex;
      expect(() => validateSwapCall(r, { ...op, data })).toThrow();
    }
  });
  it("keeps known 0x target proof unavailable even if current-state payout simulation passes", async () => {
    const { client } = fixture();
    const result = await buildNativeSwapProposal(client, { ...request("EXACT_IN", true), source: "0x" });
    expect(result).toMatchObject({ availability: "unavailable", ops: [], validation: { status: "unknown" } });
    expect(result.reason).toMatch(/simulation cannot prove mined payout/);
    expect(client.getPublicClient).not.toHaveBeenCalled();
    const result2 = await createMatchSwapTool({ zeroxApiKey: "fixture" }).execute(client, { chainId: 1, fromToken: "ETH", toToken: buy, amount: ".5", slippageBps: 100 });
    expect(result2.availability).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("delivers an unsigned authenticated result with fees and simulation explicitly unknown", async () => {
    const r = request(), { client, rpc } = fixture(r), result = await buildNativeSwapProposal(client, r);
    expect(result).toMatchObject({ availability: "available", unsigned: true, owner, chainId: 1, minimumOutputRaw: r.boundRaw, simulation: { status: "unknown" }, fees: { status: "unknown" } });
    expect(rpc.call.mock.calls[0][0].blockNumber).toBe(100n);
    expect(client.executeOps).not.toHaveBeenCalled(); expect(client.getWalletClient).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain(r.amountRaw);
  });
  it("fails schema/account/network, provider and state identity failures closed", async () => {
    const r = request();
    for (const mutate of [(c, p) => c.getAddress.mockResolvedValue(buy), (c, p) => p.getChainId.mockResolvedValue(8453), (c, p) => p.call.mockRejectedValue(new Error("timeout")), (c, p) => p.call.mockResolvedValue({ data: "0x" }), (c, p) => p.getBlock.mockResolvedValueOnce({ number: 100n, hash: blockHash, timestamp: BigInt(Math.floor(Date.now() / 1000)) }).mockResolvedValue({ number: 100n, hash: "0x" + "b".repeat(64) })]) {
      const { client, rpc } = fixture(r); mutate(client, rpc);
      expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
    }
    expect(await buildNativeSwapProposal(fixture().client, { ...r, schemaVersion: 2 } as any)).toMatchObject({ availability: "unavailable" });
    expect(await buildNativeSwapProposal(fixture().client, { ...r, chainId: 8453 })).toMatchObject({ availability: "unavailable" });
    expect(swapRequestSchema.safeParse({ ...r, amountRaw: Number(r.amountRaw) }).success).toBe(false);
    const observation = { observedAt: new Date(Date.now() - 61000).toISOString(), blockNumber: "0x64", blockHash, blockTimestamp: String(Math.floor(Date.now() / 1000)), amountInRaw: r.amountRaw, amountOutRaw: r.boundRaw };
    expect(() => deliverSwap(r, exactSwapOps(r, call(r)).ops, observation)).toThrow(/Stale/);
    expect(() => deliverSwap({ ...r, deadline: "1" }, exactSwapOps({ ...r, deadline: "1" }, call({ ...r, deadline: "1" })).ops, { ...observation, observedAt: new Date().toISOString() })).toThrow(/deadline/);
  });
  it("API fixed single hop builds the same captured call; missing optional recipient/deadline uses captured defaults", async () => {
    const r = { ...request(), source: "zrouter-api" as const }, { client } = fixture(r);
    const step = { kind: "V2", side: r.mode, tokenIn: { address: sell }, tokenOut: { address: buy }, amount: r.amountRaw, limit: r.boundRaw };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ routes: [{ expectedAmount: r.boundRaw, steps: [step] }] }))));
    expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "available" });
    for (const mutation of [{ to: buy }, { deadline: "1" }, { amount: "1" }, { limit: "1" }, { router: buy }, { tokenIn: { address: buy } }, { kind: "MATCHA" }]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ routes: [{ expectedAmount: r.boundRaw, steps: [{ ...step, ...mutation }] }] }))));
      expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
    }
  });
});

describe("bounded exact readers and financial precision", () => {
  it("accepts .5/0.5/.05 and zero decimals without rounding or Unicode numerals", () => {
    expect(parseExactUnits(".5", 2)).toBe(50n); expect(parseExactUnits("0.5", 2)).toBe(50n); expect(parseExactUnits(".05", 2)).toBe(5n); expect(parseExactUnits("0", 0)).toBe(0n);
    expect(uint256(MAX_UINT256.toString())).toBe(MAX_UINT256);
    for (const n of ["-1", "1e5", "１", "٠", "1.001", "1."]) expect(() => parseExactUnits(n, 2)).toThrow();
    for (const d of [-1, 256, 1.5, undefined, null]) expect(() => parseExactUnits("1", d as any)).toThrow();
    expect(() => uint256((MAX_UINT256 + 1n).toString())).toThrow();
    expect(() => parseExactUnits("1.0", 0)).toThrow();
  });
  it("no decimals fallback or indexer override, including curated conflict", async () => {
    const rpc: any = { readContract: vi.fn(async () => 0) };
    expect(await resolveInputToToken(sell, 1, rpc)).toMatchObject({ decimals: 0 });
    for (const d of [-1, 256, undefined, null]) {
      rpc.readContract.mockResolvedValue(d); await expect(resolveInputToToken(sell, 1, rpc)).rejects.toThrow();
    }
    rpc.readContract.mockRejectedValue(new Error("missing")); await expect(resolveInputToToken(sell, 1, rpc)).rejects.toThrow();
    rpc.readContract.mockResolvedValue(18); await expect(resolveInputToToken("USDC", 1, rpc)).rejects.toThrow(/conflicts/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("offset/length extremes, unaligned/truncated/noncanonical tails never wrap", () => {
    const good = built(request()); expect(decodeBuiltSwap(good).amountIn.toString()).toBe(request().amountRaw);
    for (const offset of [MAX_UINT256, (1n << 63n) - 1n, 225n, 0n]) {
      const data = good.slice(0, 2 + 4 * 64) + word(offset) + good.slice(2 + 5 * 64);
      expect(() => decodeBuiltSwap(data)).toThrow();
    }
    for (const length of [MAX_UINT256, 1n << 63n]) {
      const data = good.slice(0, 2 + 7 * 64) + word(length) + good.slice(2 + 8 * 64);
      expect(() => decodeBuiltSwap(data)).toThrow();
    }
    expect(() => decodeBuiltSwap(good.slice(0, -2))).toThrow();
    expect(() => decodeBuiltSwap(good + "00")).toThrow();
    expect(() => dynamicBytes("0x" + "0".repeat(64), MAX_UINT256, 32)).toThrow();
    expect(() => deserializeRoutes({ routes: Array.from({ length: 33 }, () => ({})) })).toThrow();
    expect(() => deserializeRoutes({ routes: [{ expectedAmount: 9007199254740992, steps: [] }] })).toThrow();
  });
  it("DNS encoding preserves UTF8 bytes and rejects empty/oversized labels and tails", () => {
    expect(dnsEncode("é.eth")[0]).toBe(2); expect(dnsEncode("😀.eth")[0]).toBe(4);
    for (const name of ["", ".eth", "a..eth", "a".repeat(64) + ".eth", Array.from({ length: 5 }, () => "a".repeat(63)).join(".")]) expect(() => dnsEncode(name)).toThrow();
    expect(() => readENSBytes("0x" + word(MAX_UINT256))).toThrow();
    const encoded = encodeAbiParameters([{ type: "bytes" }], ["0x1234"]); expect(readENSBytes(encoded)).toBe("0x1234");
    expect(uint256("900719925474099312345678901")).not.toBe(uint256("900719925474099312345678902"));
  });
  it("retains failed precision and failed balance independently at an exact block", async () => {
    const { client, rpc } = fixture();
    rpc.call.mockImplementation(async a => ({ data: a.data.startsWith("0x313ce567") ? "0x" : scalar(MAX_UINT256) }));
    expect(await observeAsset(client, { owner, token: sell, chainId: 1 })).toMatchObject({ status: "partial", precision: { status: "unknown", decimals: null }, balance: { status: "verified", raw: MAX_UINT256.toString() } });
    rpc.call.mockImplementation(async a => ({ data: a.data.startsWith("0x313ce567") ? scalar(0n) : "0x" }));
    expect(await observeAsset(client, { owner, token: sell, chainId: 1 })).toMatchObject({ status: "partial", precision: { status: "verified", decimals: 0 }, balance: { status: "failure", raw: null } });
  });
});

describe("guardian historical evidence", () => {
  const args = { owner, chainId: 1, ranges: [{ from: "50", through: "100" }] };
  it("two bounded scans retain the initial historical gap", async () => {
    const { client } = fixture();
    const first = await observeGuardianQueue.execute(client, args);
    expect(first.historyComplete).toBe(false);
    const second = await observeGuardianQueue.execute(client, { ...args, ranges: [{ from: "100", through: "100" }], previous: first.state });
    expect(second.historyComplete).toBe(false); expect(second.state.initialFloor).toBe("50"); expect(second.state.coveredRanges).toEqual([{ from: "50", through: "100" }]);
    expect(second.removalSafety).toBe("unknown");
  });
  it("failed historical ranges are retried and unknown known entries stay known until exact queued zero", async () => {
    const { client, rpc } = fixture(), hash = "0x" + "b".repeat(64), transactionHash = "0x" + "c".repeat(64);
    rpc.request.mockRejectedValueOnce(new Error("range failure"));
    const first = await observeGuardianQueue.execute(client, { ...args, previous: { schemaVersion: 1, owner, chainId: 1, initialFloor: "50", coveredRanges: [], failedRanges: [], knownEntries: [{ hash, transactionHash, nonce: "1" }] } });
    expect(first.entries[0].status).toBe("unknown"); expect(first.state.knownEntries).toHaveLength(1); expect(first.state.failedRanges).toEqual(args.ranges);
    rpc.call.mockResolvedValue({ data: "0x" }); rpc.request.mockResolvedValue([]);
    const second = await observeGuardianQueue.execute(client, { ...args, ranges: [{ from: "100", through: "100" }], previous: first.state });
    expect(rpc.request.mock.calls[1][0].params[0].fromBlock).toBe("0x32"); expect(second.state.knownEntries).toHaveLength(1); expect(second.state.failedRanges).toEqual([]);
    rpc.call.mockResolvedValue({ data: scalar(0n) });
    const third = await observeGuardianQueue.execute(client, { ...args, previous: second.state });
    expect(third.entries[0].status).toBe("cleared"); expect(third.state.knownEntries).toEqual([]);
  });
  it("malformed, oversized, removed and huge-nonce log responses remain historical gaps", async () => {
    for (const response of [null, Array(4097).fill({}), [{ address: owner, removed: false, topics: ["0x" + "0".repeat(64), "0x" + "1".repeat(64)], blockNumber: "0x64", data: "0x" + word(MAX_UINT256) + word(1n) }]]) {
      const { client, rpc } = fixture(); rpc.request.mockResolvedValue(response);
      const result = await observeGuardianQueue.execute(client, args); expect(result.state.failedRanges).toEqual(args.ranges); expect(result.historyComplete).toBe(false);
    }
    const { client, rpc } = fixture(); rpc.getCode.mockResolvedValue("0x");
    const result = await observeGuardianQueue.execute(client, args); expect(result.delegation).toBe("unknown"); expect(result.historyComplete).toBe(false);
  });
});

describe("screening refresh evidence", () => {
  it("expired cache plus failed refresh preserves malicious positive and makes negative unknown", async () => {
    vi.resetModules(); const { checkMaliciousAddress } = await import("./security/tools.js");
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([owner]))));
    expect(await checkMaliciousAddress.execute({} as any, { address: owner })).toMatchObject({ result: "positive", freshness: "fresh" });
    vi.advanceTimersByTime(86400001); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("refresh failed"); }));
    expect(await checkMaliciousAddress.execute({} as any, { address: owner })).toMatchObject({ result: "positive", freshness: "stale", refreshOutcome: "failure", isMalicious: true });
    expect(await checkMaliciousAddress.execute({} as any, { address: buy })).toMatchObject({ result: "unknown", freshness: "stale", isMalicious: null });
  });
  it("empty or malformed lists cannot create verified negative coverage", async () => {
    for (const list of [[], [12], ["oops"]]) {
      vi.resetModules(); const { checkMaliciousAddress } = await import("./security/tools.js");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(list))));
      expect(await checkMaliciousAddress.execute({} as any, { address: owner })).toMatchObject({ result: "unknown", isMalicious: null, refreshOutcome: "failure" });
    }
  });
});

describe("wallet evidence lifecycle controls", () => {
  it("rejects executable economics mutations before result delivery with unchanged scalar summaries", async () => {
    const r = request();
    for (const index of [0, 1, 2, 3, 4, 5, 6]) {
      const { client, rpc } = fixture(r), op = call(r);
      const old = BigInt("0x" + op.data.slice(10 + index * 64, 74 + index * 64));
      const altered = (op.data.slice(0, 10 + index * 64) + word(old + 1n) + op.data.slice(74 + index * 64)) as Hex;
      rpc.call.mockResolvedValue({ data: built(r, altered) });
      expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
    }
  });
  it("delayed quoting and unknown proxy/Curve/multicall selectors fail closed", async () => {
    const r = request(), { client, rpc } = fixture(r);
    vi.useFakeTimers();
    rpc.call.mockImplementation(async () => { vi.advanceTimersByTime(61000); return { data: built(r) }; });
    expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
    vi.useRealTimers();
    for (const selector of ["0x12db224a", "0xac9650d8", "0xdeadbeef"]) {
      const { client, rpc } = fixture(r);
      rpc.call.mockResolvedValue({ data: built(r, (selector + call(r).data.slice(10)) as Hex) });
      expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
    }
  });
  it("human-unit default request returns an unsigned exact result with zero-decimal tokens", async () => {
    const amount = "100", deadline = String(Math.floor(Date.now() / 1000) + 1200), r = { ...request(), amountRaw: amount, boundRaw: "90", deadline };
    const { client, rpc } = fixture(r); rpc.readContract.mockResolvedValue(0);
    const args = intentSwap.parameters.parse({ tokenIn: sell, tokenOut: buy, amount, side: "EXACT_IN" });
    expect(await intentSwap.execute(client, args)).toMatchObject({ availability: "available", unsigned: true, inputRaw: "100" });
    expect(client.getWalletClient).not.toHaveBeenCalled(); expect(client.executeOps).not.toHaveBeenCalled();
  });
  it("Base API uses its independently pinned target and no direct quoter fallback", async () => {
    const r = { ...request(), chainId: 8453, source: "zrouter-api" as const }, { client } = fixture(r);
    const step = { kind: "V2", side: r.mode, tokenIn: { address: sell }, tokenOut: { address: buy }, amount: r.amountRaw, limit: r.boundRaw };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ routes: [{ expectedAmount: r.boundRaw, steps: [step] }] }))));
    expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "available", execution: { target: ZROUTER_ADDRESS[8453].toLowerCase() } });
  });
  it("contract precision conflicts stay visible and balance reorgs never become zero", async () => {
    const { client, rpc } = fixture();
    rpc.call.mockImplementation(async a => ({ data: a.data.startsWith("0x313ce567") ? scalar(18n) : scalar(9n) }));
    expect(await observeAsset(client, { owner, token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", chainId: 1 })).toMatchObject({ status: "partial", precision: { status: "conflict", decimals: 18, pinnedDecimals: 6 } });
    rpc.getBlock.mockResolvedValueOnce({ number: 100n, hash: blockHash, timestamp: BigInt(Math.floor(Date.now() / 1000)) }).mockResolvedValueOnce({ number: 100n, hash: "0x" + "b".repeat(64) });
    expect(await observeAsset(client, { owner, token: sell, chainId: 1 })).toMatchObject({ status: "failure", balance: { status: "unknown", raw: null } });
  });
  it("merged historical failures retry bounded chunks without forgetting remaining gaps", async () => {
    const { client, rpc } = fixture(); rpc.getBlock.mockResolvedValue({ number: 10000n, hash: blockHash }); rpc.call.mockResolvedValue({ data: scalar(0n) });
    const previous = { schemaVersion: 1, owner, chainId: 1, initialFloor: "50", coveredRanges: [], failedRanges: [{ from: "50", through: "5049" }], knownEntries: [] };
    const result = await observeGuardianQueue.execute(client, { owner, chainId: 1, ranges: [{ from: "10000", through: "10000" }], previous });
    expect(rpc.request.mock.calls[0][0].params[0]).toMatchObject({ fromBlock: "0x32", toBlock: "0x801" });
    expect(result.state.coveredRanges[0]).toEqual({ from: "50", through: "5049" }); expect(result.historyComplete).toBe(false);
  });
  it("checkpoint mismatch never claims completion; reorg retains an entry whose zero read was invalidated", async () => {
    const { client, rpc } = fixture(), hash = "0x" + "b".repeat(64), previous = { schemaVersion: 1, owner, chainId: 1, initialFloor: "50", coveredRanges: [], failedRanges: [], knownEntries: [{ hash, nonce: "1", transactionHash: null }] };
    rpc.call.mockResolvedValue({ data: scalar(0n) }); rpc.getBlock.mockResolvedValueOnce({ number: 100n, hash: blockHash, timestamp: BigInt(Math.floor(Date.now() / 1000)) }).mockResolvedValue({ number: 100n, hash: "0x" + "c".repeat(64) });
    const result = await observeGuardianQueue.execute(client, { owner, chainId: 1, ranges: [{ from: "50", through: "100" }], previous });
    expect(result.entries[0].status).toBe("unknown"); expect(result.state.knownEntries).toHaveLength(1); expect(result.historyComplete).toBe(false);
    await expect(observeGuardianQueue.execute(fixture().client, { owner, chainId: 1, ranges: [{ from: "50", through: "100" }], previous: { ...previous, coveredRanges: [{ from: "0", through: "99" }], checkpoint: { blockNumber: "99", blockHash: "0x" + "c".repeat(64) } } })).rejects.toThrow(/checkpoint changed/);
  });
  it("payload verification binds owner/network/nonce and never fabricates unreadable calls", async () => {
    const { hashTypedData } = await import("viem"), { client, rpc } = fixture(), target = buy, value = 7n, data = "0x1234" as Hex, nonce = 42;
    const digest = hashTypedData({ domain: { name: "Multisig", version: "1", chainId: 1, verifyingContract: owner as any }, types: { Execute: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "nonce", type: "uint32" }] }, primaryType: "Execute", message: { target: target as any, value, data, nonce } });
    const transactionHash = "0x" + "c".repeat(64), input = encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes,bytes)"]), functionName: "execute", args: [target as any, value, data, "0x"] });
    const args = { owner, chainId: 1, ranges: [{ from: "50", through: "100" }], previous: { schemaVersion: 1, owner, chainId: 1, initialFloor: "50", coveredRanges: [], failedRanges: [], knownEntries: [{ hash: digest, nonce: String(nonce), transactionHash }] } };
    rpc.call.mockResolvedValue({ data: scalar(123n) }); rpc.getTransaction.mockResolvedValue({ to: owner, hash: transactionHash, blockNumber: 50n, input });
    expect(await observeGuardianQueue.execute(client, args)).toMatchObject({ entries: [{ status: "queued", payloadStatus: "verified", payload: { target, valueRaw: "7", data } }] });
    rpc.getTransaction.mockResolvedValue({ to: owner, hash: transactionHash, blockNumber: 50n, input: input.slice(0, -2) });
    expect(await observeGuardianQueue.execute(client, args)).toMatchObject({ entries: [{ status: "queued", payloadStatus: "unknown", payload: null }] });
  });
});

describe("asset observation freshness", () => {
  it("retains exact raw evidence but marks old blocks stale", async () => {
    const { client, rpc } = fixture();
    rpc.getBlock.mockResolvedValue({ number: 100n, hash: blockHash, timestamp: BigInt(Math.floor(Date.now() / 1000) - 601) });
    rpc.call.mockImplementation(async a => ({ data: a.data.startsWith("0x313ce567") ? scalar(0n) : scalar(1n) }));
    expect(await observeAsset(client, { owner, token: sell, chainId: 1 })).toMatchObject({ status: "stale", freshness: "stale", balance: { status: "verified", raw: "1" } });
  });
});

describe("review regressions", () => {
  it("ENS supports the existing 64-byte label and long multilabel name while rejecting uint8 overflow", async () => {
    const { resolveENSTool } = await import("./ens/tools.js");
    const rpc: any = { getEnsAddress: vi.fn(async () => owner) }, client: any = { getPublicClient: () => rpc };
    for (const name of ["a".repeat(64) + ".eth", Array(5).fill("a".repeat(60)).join(".") + ".eth"]) expect(await resolveENSTool.execute(client, { name })).toBe(owner);
    await expect(resolveENSTool.execute(client, { name: "a".repeat(256) + ".eth" })).rejects.toThrow();
  });
  it("unknown asset timestamps retain raw observations with partial overall status", async () => {
    for (const timestamp of [undefined, BigInt(Math.floor(Date.now() / 1000) + 3600)]) {
      const { client, rpc } = fixture(); rpc.getBlock.mockResolvedValue({ number: 100n, hash: blockHash, timestamp });
      rpc.call.mockImplementation(async a => ({ data: a.data.startsWith("0x313ce567") ? scalar(0n) : scalar(1n) }));
      expect(await observeAsset(client, { owner, token: sell, chainId: 1 })).toMatchObject({ status: "partial", freshness: "unknown", expiresAt: null, balance: { status: "verified", raw: "1" } });
    }
  });
  it("a stable stale or missing quote block timestamp cannot receive fresh availability", async () => {
    for (const timestamp of [undefined, BigInt(Math.floor(Date.now() / 1000) - 3600), BigInt(Math.floor(Date.now() / 1000) + 3600)]) {
      const r = request(), { client, rpc } = fixture(r); rpc.getBlock.mockResolvedValue({ number: 100n, hash: blockHash, timestamp });
      expect(await buildNativeSwapProposal(client, r)).toMatchObject({ availability: "unavailable", ops: [] });
      expect(rpc.call).not.toHaveBeenCalled();
    }
  });
});
