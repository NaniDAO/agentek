import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, zeroAddress, type Hex } from "viem";
import { confirmTacitSubmission } from "./confirmation.js";
import { TACIT_POOL } from "./schemas.js";

const event = parseAbiItem("event Transact(bytes32 indexed nf0,bytes32 indexed nf1,bytes32 outLeaf0,bytes32 outLeaf1,uint256 firstIndex,bytes32 newRoot,address recipient,int256 extAmount,address relayer,uint256 fee,bytes memo0,bytes memo1)");
const word = (n: number) => "0x" + n.toString(16).padStart(64, "0") as Hex;
function fixture() {
  const hash = word(55), blockHash = word(99), relayer = "0x1111111111111111111111111111111111111111";
  const log = { address: TACIT_POOL, transactionHash: hash,
    topics: encodeEventTopics({ abi: [event], eventName: "Transact", args: { nf0: word(1), nf1: word(0) } }),
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" },
      { type: "address" }, { type: "int256" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }],
    [word(2), word(3), 0n, word(4), zeroAddress, 0n, relayer, 10n, "0x1234", "0x5678"]) };
  const tx = { transactionHash: hash, blockHash, blockNumber: "0x5f", status: "0x1", logs: [log] };
  const rpc = vi.fn(async (method: string, _params?: unknown[]) => {
    switch (method) {
      case "eth_chainId": return "0x2105";
      case "eth_blockNumber": return "0x64";
      case "eth_getLogs": return tx.status === "0x1" ? [log] : [];
      case "eth_getTransactionReceipt": return tx;
      case "eth_getBlockByNumber": return { hash: blockHash };
      default: throw new Error("Unexpected RPC method");
    }
  });
  const submission = { operationRef: "operation_" + "ab".repeat(16), chainId: 8453 as const, fromBlock: "90", transactionHash: hash,
    trustedTransactionHash: true,
    tx: { nf0: "1", nf1: "0", outLeaf0: "2", outLeaf1: "3", recipient: zeroAddress,
      extAmount: "0", relayer, fee: "10", memo0: "0x1234", memo1: "0x5678" } };
  const check = () => confirmTacitSubmission({ submission, rpc, confirmations: 3 });
  return { log, tx, rpc, submission, check, hash };
}
describe("Tacit durable submission confirmation", () => {
  it("confirms the exact saved submission against canonical sufficiently deep chain data", async () => {
    const f = fixture(); expect(await f.check()).toEqual({ state: "confirmed", transactionHash: f.hash });
  });
  it("finds a lost relay response by its exact public commitments, without retrying", async () => {
    const f = fixture(); delete (f.submission as any).transactionHash;
    expect(await f.check()).toEqual({ state: "confirmed", transactionHash: f.hash });
    expect(f.rpc.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(true);
  });
  it.each(["memo0", "outLeaf0", "nf0", "fee", "recipient"])("does not accept a successful transaction with a different %s", async field => {
    const f = fixture();
    (f.submission.tx as any)[field] = field === "memo0" ? "0x9999" : field === "recipient" ? f.submission.tx.relayer : "99";
    expect((await f.check()).state).toBe("unknown");
  });
  it.each(["recent", "reorg", "removed", "wrongChain", "wrongHash"])("keeps %s evidence unknown", async failure => {
    const f = fixture();
    if (failure === "recent") f.tx.blockNumber = "0x63";
    if (failure === "reorg") f.tx.blockHash = word(98);
    if (failure === "removed") (f.log as any).removed = true;
    if (failure === "wrongHash") f.tx.transactionHash = word(56);
    if (failure === "wrongChain") f.rpc.mockResolvedValueOnce("0x1" as any);
    expect((await f.check()).state).toBe("unknown");
  });
  it("distinguishes a confirmed revert from a missing receipt", async () => {
    const f = fixture(); f.tx.status = "0x0";
    expect((await f.check()).state).toBe("failed");
    f.rpc.mockImplementation(async method => method === "eth_chainId" ? "0x2105" : method === "eth_blockNumber" ? "0x64" : null as any);
    expect((await f.check()).state).toBe("unknown");
  });

  it.each(["missingProvenance", "keeperProvenance"])("does not accept a relay-supplied reverted hash as failure evidence: %s", async failure => {
    const f = fixture(); f.tx.status = "0x0";
    if (failure === "missingProvenance") delete (f.submission as any).trustedTransactionHash;
    else f.submission.trustedTransactionHash = false;
    expect((await f.check()).state).toBe("unknown");
    expect(f.rpc.mock.calls.some(([method]) => method === "eth_getLogs")).toBe(true);
  });

  it("recovers the actual payment even when the keeper claims an unrelated reverted transaction", async () => {
    const f = fixture(), badHash = word(66);
    f.submission.transactionHash = badHash; f.submission.trustedTransactionHash = false;
    const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (method, params) => {
      if (method === "eth_getTransactionReceipt" && params?.[0] === badHash) return { ...f.tx, transactionHash: badHash, status: "0x0", logs: [] };
      return original(method, params);
    });
    expect(await f.check()).toEqual({ state: "confirmed", transactionHash: f.hash });
  });

  it("keeps a replayed relay proof's revert unknown while its real broadcast can still be pending", async () => {
    const f = fixture(); f.tx.status = "0x0"; f.submission.trustedTransactionHash = false;
    expect(await f.check()).toMatchObject({ state: "unknown", nextScanBlock: "98" });
  });

  it("resumes bounded discovery after more than 100000 blocks without changing the original submission", async () => {
    const f = fixture(); delete (f.submission as any).transactionHash;
    f.submission.fromBlock = "0";
    const block = 150_000n, head = 150_010n;
    f.tx.blockNumber = "0x" + block.toString(16);
    f.rpc.mockImplementation(async (method, params) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_blockNumber") return "0x" + head.toString(16);
      if (method === "eth_getTransactionReceipt") return f.tx;
      if (method === "eth_getBlockByNumber") return { hash: f.tx.blockHash };
      if (method === "eth_getLogs") {
        const range = params![0] as { fromBlock: string; toBlock: string };
        return BigInt(range.fromBlock) <= block && BigInt(range.toBlock) >= block ? [f.log] : [];
      }
      throw new Error("Unexpected read");
    });
    const first = await f.check();
    expect(first).toMatchObject({ state: "unknown", nextScanBlock: "100000" });
    expect(f.rpc.mock.calls.filter(([method]) => method === "eth_getLogs")).toHaveLength(50);
    const second = await confirmTacitSubmission({ submission: f.submission, rpc: f.rpc, confirmations: 3, scanFromBlock: first.nextScanBlock });
    expect(second).toEqual({ state: "confirmed", transactionHash: f.hash });
    expect(f.submission.fromBlock).toBe("0");
    const resumed = f.rpc.mock.calls.filter(([method]) => method === "eth_getLogs")[50][1]![0] as { fromBlock: string };
    expect(BigInt(resumed.fromBlock)).toBe(99_997n);
  });

  it("retains completed-range progress when a later RPC page fails", async () => {
    const f = fixture(); delete (f.submission as any).transactionHash;
    f.submission.fromBlock = "0";
    f.rpc.mockImplementation(async (method, params) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_blockNumber") return "0x10000";
      if (method === "eth_getLogs" && (params![0] as { fromBlock: string }).fromBlock === "0x0") return [];
      throw new Error("Read unavailable");
    });
    expect(await f.check()).toMatchObject({ state: "unknown", nextScanBlock: "2000" });
  });
});
