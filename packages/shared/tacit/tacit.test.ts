import { describe, expect, it, vi } from "vitest";
import { http, stringToHex } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createAgentekClient } from "../client.js";
import { allTools } from "../index.js";
import { createTacitBackend, consolidationCount } from "./backend.js";
import { tacitTools, TacitToolError } from "./tools.js";
import type { TacitWalletBinding, TacitToolBackend } from "./types.js";
import { TACIT_POOL } from "./schemas.js";
import { adaptTacitCoreWallet } from "./adapter.js";

const context = { walletRef: "wallet_primary", chainId: 8453 as const };
const recipient = "tacit1" + "q".repeat(270);
const publicAddress = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "ab".repeat(32);
const secret = "PRIVATE_IDENTITY_SIGNATURE_NOTE_GIFT_SEED_MUST_NEVER_REACH_THE_MODEL";
function fixture() {
  let clock = 1_000_000, journal: unknown = null;
  const wallet = {
    address: recipient,
    sync: vi.fn(async () => ({ balance: 1000n, block: 123, identityKey: secret, notes: [{ sk: secret, nk: secret }] })),
    rescan: vi.fn(async () => ({ balance: 1000n, block: 125, blinding: secret })),
    notes: vi.fn(() => [{ v: "1000", identityKey: secret }, { v: "0", sk: secret }]),
    receive: { address: publicAddress, waiting: vi.fn(async () => 0n), sweep: vi.fn(async () => hash) },
    quote: vi.fn(async () => ({ chainId: 8453, pool: TACIT_POOL, relayer: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec", fee: "10", signature: secret })),
    deposit: vi.fn(async () => hash), send: vi.fn(async () => hash), withdraw: vi.fn(async () => hash),
  };
  const binding: TacitWalletBinding = {
    ...context, openWallet: vi.fn(async () => wallet), getChainId: vi.fn(async () => 8453),
    confirm: vi.fn(async () => ({ state: "confirmed" as const, transactionHash: hash })),
    validateRecipient: vi.fn(to => { if (to !== recipient) throw new Error(secret); return to; }),
    relayer: { address: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec", maxFeeWei: "100" },
    watchDepositAddress: vi.fn(async () => {}), canShield: true,
    receipts: {
      create: vi.fn(async () => ({ ephemeralKey: secret, transactionHash: hash })),
      verify: vi.fn(async (_proof, expected) => ({ verified: expected.amountWei === "100" && expected.recipient === recipient, transactionHash: hash })),
    },
  };
  const store = { load: () => journal, save: vi.fn((value: unknown) => { journal = JSON.parse(JSON.stringify(value)); }) };
  const make = () => createTacitBackend({ wallets: [binding], operationStore: store, now: () => clock });
  const host = make();
  const map = new Map(tacitTools(host.tools).map(t => [t.name, t]));
  const call = (name: string, args: unknown) => map.get(name)!.execute({} as any, args);
  const quote = (action: "shield" | "transfer" | "withdraw" = "transfer") => call("quotePrivatePayment", {
    ...context, action, amountWei: "100", maxRelayFeeWei: "80",
    ...(action === "shield" ? {} : { recipient: action === "withdraw" ? publicAddress : recipient }),
  });
  const plan = async () => {
    const q = await quote();
    return call("intentPrivateTransfer", { ...context, quoteRef: q.quoteRef });
  };
  return { host, make, wallet, binding, store, call, quote, plan, advance: (ms: number) => { clock += ms; } };
}

async function expiredPlanJournal() {
  const f = fixture(), quote = await f.quote("shield");
  await f.call("intentShieldFunds", { ...context, quoteRef: quote.quoteRef });
  const template = (f.store.load() as any).operations[0];
  const records = Array.from({ length: 1024 }, (_, index) => {
    const suffix = index.toString(16).padStart(32, "0"), quoteRef = "quote_" + suffix;
    return { ...template, quote: { ...template.quote, quoteRef },
      result: { ...template.result, quoteRef, operationRef: "operation_" + suffix } };
  });
  f.store.save({ version: 1, operations: records });
  f.advance(45_001);
  return { f, records };
}

describe("Tacit tools and secret boundary", () => {
  it("registers eleven opt-in tools without opening a wallet or changing default tools", async () => {
    const f = fixture();
    expect(tacitTools(f.host.tools)).toHaveLength(11);
    const normal = await allTools({});
    const enabled = await allTools({ tacitBackend: f.host.tools });
    expect(enabled.length).toBe(normal.length + 11);
    expect(normal.some(t => t.name === "intentPrivateTransfer")).toBe(false);
    const options = await f.call("getPrivacyOptions", {});
    expect(options.wallets).toEqual([{ ...context, canShield: true, canRelay: true, canReceiveDeposits: true, canCreateReceipts: true, canVerifyReceipts: true }]);
    expect(f.binding.openWallet).not.toHaveBeenCalled();
  });

  it("returns only approved DTO fields for balances, receive addresses and recovery", async () => {
    const f = fixture();
    const results = [
      await f.call("getPrivateBalance", context),
      await f.call("recoverPrivateWallet", context),
      await f.call("getPrivateReceiveAddress", { ...context, kind: "shielded" }),
      await f.call("getPrivateReceiveAddress", { ...context, kind: "deposit" }),
    ];
    expect(results[0]).toEqual({ schemaVersion: 1, ...context, asset: "ETH", balanceWei: "1000", syncedThroughBlock: 123, complete: true });
    expect(results[1].syncedThroughBlock).toBe(125);
    expect(results[2]).toMatchObject({ kind: "shielded", address: recipient });
    expect(f.binding.watchDepositAddress).toHaveBeenCalledOnce();
    expect(JSON.stringify(results)).not.toContain(secret);
    expect(JSON.stringify(results)).not.toMatch(/identityKey|blinding|"sk"|"nk"|notes/);
  });

  it("retains legacy bp1 payment compatibility when the wallet advertises a tacit1 address", async () => {
    const f = fixture(), legacy = "bp1" + "p".repeat(160);
    vi.mocked(f.binding.validateRecipient).mockImplementation(to => {
      if (![recipient, legacy].includes(to)) throw new Error(secret);
      return to;
    });
    const q = await f.call("quotePrivatePayment", { ...context, action: "transfer", recipient: legacy, amountWei: "100", maxRelayFeeWei: "80" });
    const op = await f.call("intentPrivateTransfer", { ...context, quoteRef: q.quoteRef });
    expect(q.recipient).toBe(legacy);
    expect((await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true)).state).toBe("confirmed");
    expect(f.wallet.send).toHaveBeenCalledWith(legacy, 100n, { via: "relay", maxFee: 10n });
  });

  it("exposes only the opaque selected receipt reference from native options", async () => {
    const f = fixture(), receiptRef = "receipt_" + "ab".repeat(16);
    const backend: TacitToolBackend = { ...f.host.tools, getOptions: async () => ({
      wallets: [{ ...context, canShield: true, canRelay: true, canReceiveDeposits: true,
        canCreateReceipts: true, canVerifyReceipts: true, selectedReceiptRef: receiptRef,
        rawReceipt: { ephemeralKey: secret }, ephemeralKey: secret }],
      rawReceipt: { ephemeralKey: secret },
    }) };
    const result = await tacitTools(backend).find(tool => tool.name === "getPrivacyOptions")!.execute({} as any, {});
    expect(result.wallets[0].selectedReceiptRef).toBe(receiptRef);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toMatch(/rawReceipt|ephemeralKey/);
  });

  it.each(["identityKey", "derivationSignature", "notes", "giftSeed", "approved", "privateKey"])("rejects secret/authority input %s before contacting the host", async field => {
    const f = fixture();
    await expect(f.call("getPrivateBalance", { ...context, [field]: secret })).rejects.toMatchObject({ code: "TACIT_INVALID_REQUEST" });
    expect(f.binding.openWallet).not.toHaveBeenCalled();
  });

  it("redacts backend exceptions and invalid response diagnostics, including recognized fields", async () => {
    const f = fixture();
    vi.mocked(f.wallet.sync).mockRejectedValueOnce(new Error(secret));
    await expect(f.call("getPrivateBalance", context)).rejects.not.toThrow(secret);
    const backend = { ...f.host.tools, getBalance: async () => ({ ...context, asset: secret, balanceWei: secret, complete: true, syncedThroughBlock: 1 }) };
    const tool = tacitTools(backend).find(t => t.name === "getPrivateBalance")!;
    try { await tool.execute({} as any, context); throw new Error("expected failure"); }
    catch (e) { expect(e).toBeInstanceOf(TacitToolError); expect(String(e)).not.toContain(secret); }
  });

  it("rejects a backend response for a different wallet, chain or operation", async () => {
    const f = fixture();
    const backend: TacitToolBackend = { ...f.host.tools, getBalance: async () => ({ walletRef: "wallet_other", chainId: 1, asset: "ETH", balanceWei: "0", complete: true, syncedThroughBlock: 1 }) };
    await expect(tacitTools(backend).find(t => t.name === "getPrivateBalance")!.execute({} as any, context)).rejects.toMatchObject({ code: "TACIT_INVALID_RESPONSE" });
    await expect(f.call("getPrivateBalance", { ...context, walletRef: "wallet_other" })).rejects.toThrow();
    await expect(f.call("getPrivateBalance", { ...context, chainId: 1 })).rejects.toThrow();
  });

  it("does not issue ordinary deposit addresses without an automatic collection path", async () => {
    const f = fixture();
    const host = createTacitBackend({ wallets: [{ ...f.binding, watchDepositAddress: undefined }], operationStore: f.store });
    const tools = tacitTools(host.tools);
    await expect(tools.find(t => t.name === "getPrivateReceiveAddress")!.execute({} as any, { ...context, kind: "deposit" })).rejects.toThrow();
  });

  it("preserves explicit partial-scan coverage rather than reporting a complete balance", async () => {
    const f = fixture();
    vi.mocked(f.wallet.sync).mockResolvedValue({ balance: 0n, block: 123, complete: false } as any);
    expect(await f.call("getPrivateBalance", context)).toMatchObject({ balanceWei: "0", complete: false });
  });

  it("labels keeper-backed core sync incomplete and only a successful chain rescan complete", async () => {
    const f = fixture();
    const core = { ...f.wallet, receiveBox: publicAddress, waiting: async () => 0n,
      watchReceive: async () => ({ status: 200, body: {} }), sweep: async () => hash,
      deposit: async () => hash, send: async () => hash, withdraw: async () => hash };
    const { wallet } = adaptTacitCoreWallet(core);
    const host = createTacitBackend({ wallets: [{ ...f.binding, openWallet: async () => wallet }], operationStore: f.store });
    expect(await host.tools.getBalance(context)).toMatchObject({ balanceWei: "1000", syncedThroughBlock: 123, complete: false });
    expect(f.wallet.rescan).not.toHaveBeenCalled();
    expect(await host.tools.recover(context)).toMatchObject({ balanceWei: "1000", syncedThroughBlock: 125, complete: true });
    f.wallet.rescan.mockRejectedValueOnce(new Error("Chain scan unavailable"));
    await expect(host.tools.recover(context)).rejects.toThrow();
    expect(await host.tools.getBalance(context)).toMatchObject({ complete: false });
  });
});

describe("Tacit quotes, approval and outcomes", () => {
  it("quotes exact amounts and reserves a bounded eight-transaction maximum", async () => {
    const f = fixture();
    const q = await f.quote();
    expect(q).toMatchObject({ amountWei: "100", relayFeeWei: "10", estimatedRelayFeeWei: "10", totalRelayFeeWei: "80", maximumRelayTransactions: 8, consolidationTransactions: 0 });
    expect(JSON.stringify(q)).not.toContain(secret);
    expect(f.wallet.send).not.toHaveBeenCalled();
    await expect(f.call("quotePrivatePayment", { ...context, action: "transfer", amountWei: "100", recipient, maxRelayFeeWei: "79" })).rejects.toThrow();
    expect(consolidationCount([40n, 40n, 40n], 100n, 10n)).toBe(1);
    expect(consolidationCount([40n, 40n], 100n, 10n)).toBe(null);
  });

  it.each([
    { chainId: 1 }, { pool: publicAddress }, { relayer: publicAddress }, { fee: "101" }, { fee: "-1" },
  ])("refuses an unbound or excessive relay quote: %j", async change => {
    const f = fixture(), q = await f.wallet.quote();
    vi.mocked(f.wallet.quote).mockResolvedValue({ ...q, ...change } as any);
    await expect(f.quote()).rejects.toThrow();
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("plans idempotently without proving, signing or submitting; rejects the wrong intent action", async () => {
    const f = fixture(), q = await f.quote();
    const a = await f.call("intentPrivateTransfer", { ...context, quoteRef: q.quoteRef });
    expect(await f.call("intentPrivateTransfer", { ...context, quoteRef: q.quoteRef })).toEqual(a);
    expect(a.state).toBe("awaiting_approval");
    expect(f.wallet.send).not.toHaveBeenCalled();
    await expect(f.call("intentPrivateWithdraw", { ...context, quoteRef: q.quoteRef })).rejects.toThrow();
    await expect(f.call("intentPrivateTransfer", { ...context, quoteRef: q.quoteRef, approved: true })).rejects.toThrow();
  });

  it("makes duplicate concurrent plans wait for the same durable save", async () => {
    const f = fixture(), quote = await f.quote();
    let durable!: () => void, firstFinished = false, secondFinished = false;
    f.store.save.mockImplementationOnce(() => new Promise<void>(resolve => { durable = resolve; }) as any);
    const args = { ...context, quoteRef: quote.quoteRef, action: "transfer" as const };
    const first = f.host.tools.plan(args).then(value => { firstFinished = true; return value; });
    await vi.waitFor(() => expect(durable).toBeTypeOf("function"));
    const second = f.host.tools.plan(args).then(value => { secondFinished = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(firstFinished).toBe(false); expect(secondFinished).toBe(false);
    expect(f.store.save).toHaveBeenCalledOnce();
    durable();
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(f.store.save).toHaveBeenCalledOnce();
  });

  it("rejects every duplicate plan caller if its shared durable save fails", async () => {
    const f = fixture(), quote = await f.quote();
    let rejectSave!: (error: Error) => void;
    f.store.save.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }) as any);
    const args = { ...context, quoteRef: quote.quoteRef, action: "transfer" as const };
    const first = f.host.tools.plan(args);
    await vi.waitFor(() => expect(rejectSave).toBeTypeOf("function"));
    const second = f.host.tools.plan(args), outcomes = Promise.allSettled([first, second]);
    await Promise.resolve(); await Promise.resolve();
    rejectSave(new Error("Unavailable storage"));
    expect((await outcomes).map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(f.store.save).toHaveBeenCalledOnce();
    const retried: any = await f.host.tools.plan(args);
    expect(retried.state).toBe("awaiting_approval");
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("reclaims expired never-submitted plans durably after restart instead of wedging at the journal cap", async () => {
    const { f } = await expiredPlanJournal(), restored = f.make();
    const quote: any = await restored.tools.quotePayment({ ...context, action: "shield", amountWei: "100", maxRelayFeeWei: "0" });
    expect((f.store.load() as any).operations).toEqual([]);
    const op: any = await restored.tools.plan({ ...context, action: "shield", quoteRef: quote.quoteRef });
    expect(op.state).toBe("awaiting_approval");
    expect((f.store.load() as any).operations).toHaveLength(1);
    expect(f.wallet.deposit).not.toHaveBeenCalled();
  });

  it("preserves interrupted and confirmed evidence while pruning expired proposals", async () => {
    const { f, records } = await expiredPlanJournal();
    records[0].result.state = "unknown";
    records[1].result.state = "confirmed"; records[1].result.transactionHash = hash;
    f.store.save({ version: 1, operations: records });
    const restored = f.make();
    await expect(restored.tools.quotePayment({ ...context, action: "shield", amountWei: "100", maxRelayFeeWei: "0" })).rejects.toThrow();
    const retained = (f.store.load() as any).operations;
    expect(retained).toHaveLength(2);
    expect(retained.map((record: any) => record.result.state)).toEqual(["unknown", "confirmed"]);
    expect(retained[1].result.transactionHash).toBe(hash);
  });

  it("does not silently evict a full journal of confirmed financial history", async () => {
    const { f, records } = await expiredPlanJournal();
    for (const record of records) { record.result.state = "confirmed"; record.result.transactionHash = hash; }
    f.store.save({ version: 1, operations: records });
    await expect(f.make().tools.quotePayment({ ...context, action: "shield", amountWei: "100", maxRelayFeeWei: "0" })).rejects.toThrow();
    expect((f.store.load() as any).operations).toHaveLength(1024);
  });

  it("requires failed cleanup persistence to succeed before issuing a new quote", async () => {
    const { f } = await expiredPlanJournal(), restored = f.make();
    f.store.save.mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    const args = { ...context, action: "shield" as const, amountWei: "100", maxRelayFeeWei: "0" };
    await expect(restored.tools.quotePayment(args)).rejects.toThrow();
    expect((f.store.load() as any).operations).toHaveLength(1024);
    await expect(restored.tools.quotePayment(args)).resolves.toBeDefined();
    expect((f.store.load() as any).operations).toEqual([]);
  });

  it("executes only once across concurrent host approvals and confirms through the host reader", async () => {
    const f = fixture(), op = await f.plan(), approve = vi.fn(async () => true);
    const results = await Promise.all([1, 2].map(() => f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, approve)));
    expect(results[0]).toMatchObject({ state: "confirmed", transactionHash: hash });
    expect(results[1]).toEqual(results[0]);
    expect(approve).toHaveBeenCalledOnce();
    expect(f.wallet.send).toHaveBeenCalledOnce();
    expect(f.wallet.send).toHaveBeenCalledWith(recipient, 100n, { via: "relay", maxFee: 10n });
    expect(f.binding.confirm).toHaveBeenCalled();
    expect(JSON.stringify(f.store.load())).not.toContain(secret);
  });

  it("does not execute rejected, expired or changed-fee quotes", async () => {
    const f = fixture(), op = await f.plan();
    expect((await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => false)).state).toBe("rejected");
    const op2 = await f.plan();
    f.advance(45_001);
    expect((await f.host.approveAndExecute({ ...context, operationRef: op2.operationRef }, async () => true)).state).toBe("expired");
    const op3 = await f.plan();
    const quote = await f.wallet.quote();
    vi.mocked(f.wallet.quote).mockResolvedValue({ ...quote, fee: "11" });
    expect((await f.host.approveAndExecute({ ...context, operationRef: op3.operationRef }, async () => true)).state).toBe("failed");
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("keeps unknown submissions locked across restarts and reconciles before allowing more spending", async () => {
    const f = fixture(), op = await f.plan();
    vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error(secret));
    vi.mocked(f.binding.confirm).mockResolvedValue({ state: "unknown" });
    expect((await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true)).state).toBe("unknown");
    const restarted = f.make();
    await expect(restarted.tools.quotePayment({ ...context, action: "transfer", amountWei: "100", recipient, maxRelayFeeWei: "80" })).rejects.toThrow();
    expect((await restarted.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true)).state).toBe("unknown");
    expect(f.wallet.send).toHaveBeenCalledOnce();
    vi.mocked(f.binding.confirm).mockResolvedValue({ state: "confirmed", transactionHash: hash });
    expect(await restarted.tools.getOperation({ ...context, operationRef: op.operationRef })).toMatchObject({ state: "confirmed", transactionHash: hash });
    expect(await restarted.tools.quotePayment({ ...context, action: "transfer", amountWei: "100", recipient, maxRelayFeeWei: "80" })).toBeDefined();
  });

  it("allows a read-only chain rescan to reconcile an unknown payment without resubmitting it", async () => {
    const f = fixture(), op = await f.plan();
    vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error(secret));
    await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    expect(await f.call("recoverPrivateWallet", context)).toMatchObject({ balanceWei: "1000" });
    expect(f.wallet.rescan).toHaveBeenCalledOnce();
    expect(f.wallet.send).toHaveBeenCalledOnce();
    expect(await f.call("getPrivateOperationStatus", { ...context, operationRef: op.operationRef })).toMatchObject({ state: "confirmed" });
  });

  it("shares one chain reconciliation across concurrent status requests", async () => {
    const f = fixture(), op = await f.plan();
    vi.mocked(f.wallet.send).mockRejectedValueOnce(new Error(secret));
    await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    let finish!: (value: { state: "confirmed"; transactionHash: string }) => void;
    vi.mocked(f.binding.confirm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const requests = [1, 2].map(() => f.call("getPrivateOperationStatus", { ...context, operationRef: op.operationRef }));
    await vi.waitFor(() => expect(f.binding.confirm).toHaveBeenCalledOnce());
    finish({ state: "confirmed", transactionHash: hash });
    const results = await Promise.all(requests);
    expect(results[0]).toMatchObject({ state: "confirmed", transactionHash: hash });
    expect(results[1]).toEqual(results[0]);
    expect(f.binding.confirm).toHaveBeenCalledOnce();
    expect(f.wallet.send).toHaveBeenCalledOnce();
  });

  it("expires an approved quote if its final wallet synchronization outlasts the quote", async () => {
    const f = fixture(), op = await f.plan();
    vi.mocked(f.wallet.sync).mockImplementationOnce(async () => {
      f.advance(45_001); return { balance: 1000n, block: 124, identityKey: secret, notes: [] };
    });
    expect((await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true)).state).toBe("expired");
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("refuses spending if the journal cannot persist the pre-submission state", async () => {
    const f = fixture(), op = await f.plan();
    f.store.save.mockImplementation(() => { throw new Error(secret); });
    await expect(f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true)).rejects.not.toThrow(secret);
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("awaits native durable storage before proving or submitting", async () => {
    const f = fixture(), op = await f.plan();
    let durable!: () => void;
    f.store.save.mockImplementationOnce(() => new Promise<void>(resolve => { durable = resolve; }) as any);
    const execution = f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    await vi.waitFor(() => expect(durable).toBeTypeOf("function"));
    expect(f.wallet.send).not.toHaveBeenCalled();
    durable();
    expect((await execution).state).toBe("confirmed");
    expect(f.wallet.send).toHaveBeenCalledOnce();
  });

  it("checks chain identity after approval and rejects a chain switched in the approval UI", async () => {
    const f = fixture(), op = await f.plan();
    const result = await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => {
      vi.mocked(f.binding.getChainId).mockResolvedValue(1); return true;
    });
    expect(result.state).toBe("failed");
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("does not execute a saved intent if a wallet alias maps to a different identity after restart", async () => {
    const f = fixture(), op = await f.plan();
    f.wallet.address = "bp1" + "p".repeat(160);
    vi.mocked(f.binding.validateRecipient).mockImplementation(to => to);
    const restarted = f.make();
    const result = await restarted.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    expect(result.state).toBe("expired");
    expect(f.wallet.send).not.toHaveBeenCalled();
  });

  it("supports shielding and public withdrawals without accepting a new recipient at execution", async () => {
    const f = fixture();
    const shield = await f.quote("shield");
    const op = await f.call("intentShieldFunds", { ...context, quoteRef: shield.quoteRef });
    await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    expect(f.wallet.deposit).toHaveBeenCalledWith(100n);
    const withdraw = await f.quote("withdraw");
    const op2 = await f.call("intentPrivateWithdraw", { ...context, quoteRef: withdraw.quoteRef });
    await f.host.approveAndExecute({ ...context, operationRef: op2.operationRef }, async () => true);
    expect(f.wallet.withdraw).toHaveBeenCalledWith(publicAddress, 100n, { via: "relay", maxFee: 10n });
  });
});

describe("private receipts and identity signatures", () => {
  it("keeps raw disclosures in a scoped vault and requires host approval for export", async () => {
    const f = fixture(), op = await f.plan();
    await expect(f.call("createPrivatePaymentReceipt", { ...context, operationRef: op.operationRef })).rejects.toThrow();
    await f.host.approveAndExecute({ ...context, operationRef: op.operationRef }, async () => true);
    const receipt = await f.call("createPrivatePaymentReceipt", { ...context, operationRef: op.operationRef });
    expect(receipt).toMatchObject({ verified: true, recipient, amountWei: "100", transactionHash: hash });
    expect(JSON.stringify(receipt)).not.toContain(secret);
    const proof = await f.host.exportReceiptForUser({ ...context, receiptRef: receipt.receiptRef }, async () => true);
    expect(proof.ephemeralKey).toBe(secret);
    await expect(f.host.exportReceiptForUser({ ...context, receiptRef: receipt.receiptRef }, async () => false)).rejects.toThrow();
    const imported = f.host.importReceipt(context, proof);
    expect(await f.call("verifyPrivatePaymentReceipt", { ...context, receiptRef: imported, recipient, amountWei: "100" })).toMatchObject({ verified: true });
    expect(await f.call("verifyPrivatePaymentReceipt", { ...context, receiptRef: imported, recipient, amountWei: "101" })).toMatchObject({ verified: false });
    expect(JSON.stringify(f.store.load())).not.toContain(secret);
  });

  it("blocks Tacit identity messages in generic signing before the signer is invoked", async () => {
    const client = createAgentekClient({ chains: [base], transports: [http()], tools: [], accountOrAddress: privateKeyToAccount("0x" + "01".repeat(32) as any) });
    const signMessage = vi.fn(async () => secret);
    vi.spyOn(client, "getWalletClient").mockReturnValue({ signMessage } as any);
    const message = "Tacit identity\n\nSigning this creates your Tacit private key. Anyone who has this signature controls all of your Tacit funds.\n\nSign it only in a Tacit app you trust. Every Tacit app asks for exactly this message.\n\nnetwork: mainnet\nversion: 1";
    for (const value of [message, { raw: stringToHex(message) }, { raw: new TextEncoder().encode(message) }]) {
      await expect(client.executeSign([{ type: "personal_sign", message: value }], 8453)).rejects.toThrow("trusted wallet host");
    }
    expect(signMessage).not.toHaveBeenCalled();
    expect(await client.executeSign([{ type: "personal_sign", message: "Ordinary login" }], 8453)).toEqual([secret]);
  });
});
