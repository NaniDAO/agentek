import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hex } from "viem";
import { createTacitReceiptService, type TacitReceiptReader } from "./receipts.js";
import { TACIT_POOL } from "./schemas.js";
import { adaptTacitCoreWallet, createTacitHostTransport, createTacitWalletSession } from "./adapter.js";

const hash = "0x" + "11".repeat(32), recipient = "bp1" + "q".repeat(160);
const event = parseAbiItem("event Transact(bytes32 indexed nf0, bytes32 indexed nf1, bytes32 outLeaf0, bytes32 outLeaf1, uint256 firstIndex, bytes32 newRoot, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1)");
const word = (n: number) => "0x" + n.toString(16).padStart(64, "0") as Hex;
function fixture() {
  const log = {
    address: TACIT_POOL,
    removed: false,
    topics: encodeEventTopics({ abi: [event], eventName: "Transact", args: { nf0: word(1), nf1: word(0) } }),
    data: encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" },
      { type: "address" }, { type: "int256" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" },
    ], [word(2), word(3), 0n, word(4), "0x0000000000000000000000000000000000000000", 0n,
      "0x1111111111111111111111111111111111111111", 10n, "0x1234", "0x5678"]),
  };
  const tx = { transactionHash: hash, status: "success", blockNumber: 98n, blockHash: word(98), logs: [log] };
  const reader: TacitReceiptReader = {
    getChainId: vi.fn(async () => 8453), getBlockNumber: vi.fn(async () => 100n),
    getBlock: vi.fn(async () => ({ hash: word(98) })),
    getTransactionReceipt: vi.fn(async () => tx as any),
  };
  const runtime = {
    validateRecipient: vi.fn((to: string) => to),
    deriveKey: vi.fn(({ outputIndex, attempt }: any) => BigInt(100 + outputIndex + attempt)),
    verify: vi.fn(({ recipient: to, ephemeralKey, memo, leaf, asset }: any) =>
      to === recipient && ephemeralKey === 100n && memo === "0x1234" && leaf === 2n && typeof asset === "bigint" ? 50n : null),
  };
  const service = createTacitReceiptService({ chainId: 8453, reader, runtime });
  return { tx, log, reader, runtime, service };
}

describe("private receipt chain binding", () => {
  it("creates and verifies a selected-output disclosure against the actual Transact ABI", async () => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    const raw: any = await f.service.create(input);
    expect(raw).toEqual({ version: 1, chainId: 8453, transactionHash: hash, logIndex: 0, outputIndex: 0, ephemeralKey: "100" });
    expect(await f.service.verify(raw, input)).toEqual({ verified: true, transactionHash: hash });
    expect(f.reader.getBlock).toHaveBeenCalledWith({ blockNumber: 98n });
    expect(await f.service.verify({ ...raw, ephemeralKey: "101" }, input)).toMatchObject({ verified: false });
    expect(await f.service.verify(raw, { ...input, amountWei: "51" })).toMatchObject({ verified: false });
    expect(await f.service.verify(raw, { ...input, recipient: "bp1" + "p".repeat(160) })).toMatchObject({ verified: false });
    expect(await f.service.verify({ ...raw, logIndex: 1 }, input)).toMatchObject({ verified: false });
  });

  it.each(["orphanedBlock", "missingReceiptHash", "invalidReceiptHash", "missingCanonicalBlock", "invalidCanonicalHash", "unavailableCanonicalBlock"])("rejects noncanonical receipt evidence for creation and verification: %s", async failure => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    const raw = await f.service.create(input);
    if (failure === "orphanedBlock") vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: word(99) });
    if (failure === "missingReceiptHash") delete (f.tx as any).blockHash;
    if (failure === "invalidReceiptHash") f.tx.blockHash = "0x01";
    if (failure === "missingCanonicalBlock") vi.mocked(f.reader.getBlock).mockResolvedValue(null as any);
    if (failure === "invalidCanonicalHash") vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: "0x01" });
    if (failure === "unavailableCanonicalBlock") vi.mocked(f.reader.getBlock).mockRejectedValue(new Error("RPC unavailable"));
    f.runtime.verify.mockClear();
    await expect(f.service.verify(raw, input)).rejects.toThrow();
    await expect(f.service.create(input)).rejects.toThrow();
    expect(f.runtime.verify).not.toHaveBeenCalled();
  });

  it.each([true, "true", null])("rejects removed or malformed payment logs for creation and verification: %s", async removed => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    const raw = await f.service.create(input);
    (f.log as any).removed = removed;
    f.runtime.verify.mockClear();
    expect(await f.service.verify(raw, input)).toMatchObject({ verified: false });
    await expect(f.service.create(input)).rejects.toThrow();
    expect(f.runtime.verify).not.toHaveBeenCalled();
  });

  it("accepts an omitted removed flag and case-insensitive canonical hashes without caching chain evidence", async () => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    delete (f.log as any).removed;
    f.tx.blockHash = ("0x" + "ab".repeat(32)) as Hex;
    vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: "0x" + "AB".repeat(32) });
    const raw = await f.service.create(input);
    expect(await f.service.verify(raw, input)).toMatchObject({ verified: true });
    vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: word(99) });
    await expect(f.service.verify(raw, input)).rejects.toThrow();
    vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: f.tx.blockHash });
    expect(await f.service.verify(raw, input)).toMatchObject({ verified: true });
  });

  it("retains original receipt indexes when a neighboring payment log was removed", async () => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    f.tx.logs.unshift({ ...f.log, removed: true });
    const raw: any = await f.service.create(input);
    expect(raw.logIndex).toBe(1);
    expect(await f.service.verify(raw, input)).toMatchObject({ verified: true });
    expect(await f.service.verify({ ...raw, logIndex: 0 }, input)).toMatchObject({ verified: false });
  });

  it("verifies an existing disclosure after its transaction is re-included in a canonical block", async () => {
    const f = fixture(), input = { transactionHash: hash, recipient, amountWei: "50" };
    const raw = await f.service.create(input);
    f.tx.blockNumber = 97n; f.tx.blockHash = word(97);
    vi.mocked(f.reader.getBlock).mockResolvedValue({ hash: word(97) });
    expect(await f.service.verify(raw, input)).toMatchObject({ verified: true });
    expect(f.reader.getBlock).toHaveBeenLastCalledWith({ blockNumber: 97n });
  });

  it.each(["wrongChain", "wrongHash", "reverted", "tooRecent", "wrongPool"])("refuses non-evidence: %s", async failure => {
    const f = fixture();
    if (failure === "wrongChain") vi.mocked(f.reader.getChainId).mockResolvedValue(1);
    if (failure === "wrongHash") f.tx.transactionHash = "0x" + "22".repeat(32);
    if (failure === "reverted") f.tx.status = "reverted";
    if (failure === "tooRecent") vi.mocked(f.reader.getBlockNumber).mockResolvedValue(99n);
    if (failure === "wrongPool") f.log.address = "0x1111111111111111111111111111111111111111";
    await expect(f.service.create({ transactionHash: hash, recipient, amountWei: "50" })).rejects.toThrow();
  });

  it("rejects a receipt for a different chain and secret-bearing extra fields", async () => {
    const f = fixture(), expected = { recipient, amountWei: "50" };
    const raw: any = await f.service.create({ transactionHash: hash, ...expected });
    await expect(f.service.verify({ ...raw, chainId: 1 }, expected)).rejects.toThrow();
    await expect(f.service.verify({ ...raw, identityKey: "never accept" }, expected)).rejects.toThrow();
  });
});

describe("Tacit runtime adapters", () => {
  it("constructs the actual core with explicit deployment and relayer pins in Node", () => {
    const core: any = { address: recipient, receiveBox: "0x1111111111111111111111111111111111111111" };
    const createWallet = vi.fn(() => core);
    const options = { chainId: 8453 as const, createWallet, zk: {}, keys: { private: true },
      prove: async () => ({ proof: { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"] }, publicSignals: [] }),
      rpc: async () => "0x2105", keeper: "https://keeper.example/evm-pool/keeper" };
    createTacitWalletSession(options);
    expect(createWallet).toHaveBeenCalledWith(expect.objectContaining({ chain: expect.objectContaining({
      chainId: 8453, pool: TACIT_POOL, relayer: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec", confirmations: 10,
    }) }));
    expect(() => createTacitWalletSession({ ...options, keeper: "https://user:secret@keeper.example" })).toThrow();
    expect(() => createTacitWalletSession({ ...options, chainId: 10 as any })).toThrow();
  });

  it("maps the real core's object-based calls without exposing its keys", async () => {
    const core = { address: recipient, receiveBox: "0x1111111111111111111111111111111111111111",
      sync: vi.fn(async () => ({ balance: 50n, block: 1 })), rescan: vi.fn(async () => ({ balance: 50n, block: 1 })),
      notes: vi.fn(() => [{ v: 50n, sk: "private" }]), waiting: vi.fn(async () => 0n),
      watchReceive: vi.fn(async () => ({ status: 200, body: {} })), quote: vi.fn(async () => ({})),
      deposit: vi.fn(async () => hash), send: vi.fn(async () => hash), withdraw: vi.fn(async () => hash), sweep: vi.fn(async () => hash),
    };
    const { wallet, watchDepositAddress } = adaptTacitCoreWallet(core);
    await wallet.send(recipient, 50n, { via: "relay", maxFee: 2n });
    expect(core.send).toHaveBeenCalledWith({ to: recipient, amount: 50n, via: "relay", maxFee: 2n });
    await wallet.deposit(50n);
    expect(core.deposit).toHaveBeenCalledWith({ amount: 50n });
    await watchDepositAddress();
    core.watchReceive.mockResolvedValue({ status: 503, body: {} });
    await expect(watchDepositAddress()).rejects.toThrow();
  });

  it("has no execute, approval or key-export route on the native-host transport", async () => {
    const request = vi.fn(async () => ({})), backend = createTacitHostTransport(request);
    await backend.getBalance({ walletRef: "wallet_primary", chainId: 8453 });
    expect(request).toHaveBeenCalledWith({ version: 1, method: "getBalance", params: { walletRef: "wallet_primary", chainId: 8453 } });
    expect(Object.keys(backend)).not.toContain("approveAndExecute");
    expect(Object.keys(backend)).not.toContain("exportReceiptForUser");
  });
});
