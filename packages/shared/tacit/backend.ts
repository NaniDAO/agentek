import { z } from "zod";
import { keccak256, stringToHex } from "viem";
import type { TacitEvmWallet, TacitHost, TacitToolBackend, TacitWalletBinding, TacitOperationStore } from "./types.js";
import {
  TACIT_POOL, TACIT_ROUTER, contextSchema, paymentSchema, quoteSchema, operationSchema,
  amountSchema, positiveAmountSchema, evmAddressSchema, poolAddressSchema, hashSchema,
  operationRefSchema, receiptRefSchema,
  type TacitContext, type TacitPayment, type TacitQuote, type TacitOperation,
} from "./schemas.js";

const RELAYERS = {
  1: "0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0",
  8453: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec",
} as const;
const MAX_FEE = { 1: 50_000_000_000_000_000n, 8453: 2_000_000_000_000_000n } as const;
const MAX_ENTRIES = 1_024;
// Tacit's current wallet prepares at most seven merges and then one final spend.
const MAX_RELAY_TRANSACTIONS = 8;
const relayQuoteSchema = z.object({ chainId: z.number().int(), pool: evmAddressSchema,
  relayer: evmAddressSchema, fee: amountSchema }).strip();
type StoredQuote = { request: TacitPayment; quote: TacitQuote; walletFingerprint: string; operationRef?: string; planning?: Promise<TacitOperation> };
type StoredOperation = { quote: StoredQuote; result: TacitOperation; running?: Promise<TacitOperation>; reconciling?: Promise<TacitOperation> };

function opaque(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}_${Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("")}`;
}
const keyOf = (c: TacitContext) => `${c.walletRef}:${c.chainId}`;
function fail(): never { throw new Error("Tacit request unavailable. Check the trusted wallet host."); }
const cloned = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Non-cryptographic planning matching Tacit's two-input wallet and seven-merge limit. */
export function consolidationCount(values: bigint[], amount: bigint, fee: bigint): number | null {
  const available = [...values];
  const required = amount + fee;
  for (let merges = 0; merges < MAX_RELAY_TRANSACTIONS; merges++) {
    available.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const largest = available.at(-1) ?? 0n;
    if (largest + (available.at(-2) ?? 0n) >= required) return merges;
    if (available.length < 2 || merges === MAX_RELAY_TRANSACTIONS - 1) return null;
    const joined = available.pop()! + available.pop()! - fee;
    if (joined <= 0n) return null;
    available.push(joined);
  }
  return null;
}

/**
 * Host-side coordinator over Tacit's wallet. Keeps wallet objects, notes and raw
 * receipt disclosures in closures. Pass only `.tools` to an agent. This process
 * must be trusted with the configured wallet; it is not a remote key service.
 * Use one active coordinator per wallet and supply an atomic durable operation store. Interrupted proving or
 * submission restores as unknown and blocks spending until chain reconciliation.
 */
export function createTacitBackend({ wallets, operationStore, now = Date.now, quoteLifetimeMs = 45_000 }: {
  wallets: readonly TacitWalletBinding[]; operationStore: TacitOperationStore; now?: () => number; quoteLifetimeMs?: number;
}): TacitHost {
  if (!operationStore || wallets.length < 1 || wallets.length > 64 || quoteLifetimeMs < 1_000 || quoteLifetimeMs > 120_000) fail();
  const bindings = new Map<string, TacitWalletBinding>();
  for (const source of wallets) {
    const context = contextSchema.parse({ walletRef: source.walletRef, chainId: source.chainId });
    if (bindings.has(keyOf(context))) fail();
    const relayer = source.relayer && { address: evmAddressSchema.parse(source.relayer.address), maxFeeWei: amountSchema.parse(source.relayer.maxFeeWei) };
    if (relayer && (relayer.address.toLowerCase() !== RELAYERS[context.chainId].toLowerCase() || BigInt(relayer.maxFeeWei) > MAX_FEE[context.chainId])) fail();
    // Copy configuration so later changes to a caller-owned descriptor cannot switch the authorized wallet or chain.
    bindings.set(keyOf(context), { ...source, ...context, relayer });
  }
  const instances = new Map<string, Promise<TacitEvmWallet>>();
  const quotes = new Map<string, StoredQuote>();
  const operations = new Map<string, StoredOperation>();
  const receipts = new Map<string, { context: TacitContext; proof: unknown; public?: unknown }>();
  const busy = new Map<string, string>();

  let saving: Promise<void> = Promise.resolve();
  let cleanupRevision = 0, savedCleanupRevision = 0;
  function persist(): Promise<void> {
    const snapshot = cloned({ version: 1, operations: [...operations.values()].map(op => ({
      request: op.quote.request, quote: op.quote.quote, result: op.result,
      walletFingerprint: op.quote.walletFingerprint,
    })) });
    const saved = saving.catch(() => {}).then(() => operationStore.save(snapshot));
    saving = saved;
    return saved;
  }
  const saved = operationStore.load();
  if (saved != null) {
    const journal = z.object({ version: z.literal(1), operations: z.array(z.object({
      request: paymentSchema, quote: quoteSchema, result: operationSchema, walletFingerprint: hashSchema,
    }).strict()).max(MAX_ENTRIES) }).strict().parse(saved);
    for (const record of journal.operations) {
      const { request, quote, result, walletFingerprint } = record;
      binding(request);
      if (keyOf(request) !== keyOf(quote) || keyOf(request) !== keyOf(result) || quote.quoteRef !== result.quoteRef
        || request.action !== quote.action || request.action !== result.action || request.amountWei !== quote.amountWei
        || request.recipient !== quote.recipient || operations.has(result.operationRef) || quotes.has(quote.quoteRef)) fail();
      if (result.state === "proving" || result.state === "submitted") result.state = "unknown";
      if (result.state === "awaiting_approval" && quote.expiresAt <= now()) result.state = "expired";
      const q = { request, quote, walletFingerprint, operationRef: result.operationRef };
      quotes.set(quote.quoteRef, q);
      operations.set(result.operationRef, { quote: q, result });
      if (result.state === "unknown") {
        if (busy.has(keyOf(result))) fail();
        busy.set(keyOf(result), result.operationRef);
      }
    }
  }

  function binding(context: TacitContext) {
    const c = contextSchema.parse({ walletRef: context.walletRef, chainId: context.chainId });
    const b = bindings.get(keyOf(c));
    if (!b) fail();
    return b;
  }
  async function open(c: TacitContext) {
    const b = binding(c);
    if (await b.getChainId() !== c.chainId) fail();
    const key = keyOf(c);
    if (!instances.has(key)) {
      const opened = Promise.resolve().then(() => b.openWallet());
      instances.set(key, opened);
      opened.catch(() => { if (instances.get(key) === opened) instances.delete(key); });
    }
    return { b, wallet: await instances.get(key)! };
  }
  async function balance(c: TacitContext, recover = false) {
    const { wallet } = await open(c);
    const state = await (recover ? wallet.rescan() : wallet.sync());
    return { ...c, asset: "ETH", balanceWei: amountSchema.parse(String(state.balance)),
      syncedThroughBlock: z.number().int().nonnegative().safe().parse(state.block),
      complete: state.complete === undefined ? true : z.boolean().parse(state.complete) };
  }
  async function quoteData(request: TacitPayment) {
    const { b, wallet } = await open(request);
    const walletFingerprint = keccak256(stringToHex(poolAddressSchema.parse(b.validateRecipient(wallet.address))));
    let recipient = request.recipient;
    if (request.action === "shield") {
      if (!b.canShield) fail();
      return { walletFingerprint, relayFeeWei: "0", totalRelayFeeWei: "0", estimatedRelayFeeWei: "0", maximumRelayTransactions: 0 as const, consolidationTransactions: 0, recipient: undefined };
    }
    if (!b.relayer) fail();
    if (request.action === "transfer") recipient = poolAddressSchema.parse(b.validateRecipient(recipient!));
    else {
      recipient = evmAddressSchema.parse(recipient);
      if ([TACIT_POOL, TACIT_ROUTER].some(a => a.toLowerCase() === recipient!.toLowerCase())) fail();
    }
    await wallet.sync();
    const relay = relayQuoteSchema.parse(await wallet.quote());
    const perTransaction = BigInt(relay.fee);
    if (relay.chainId !== request.chainId || relay.pool.toLowerCase() !== TACIT_POOL.toLowerCase()
      || relay.relayer.toLowerCase() !== b.relayer.address.toLowerCase()
      || perTransaction > BigInt(b.relayer.maxFeeWei)) fail();
    // Conservatively reserve fees for every transaction the core can issue. A concurrent
    // change in note fragmentation cannot exceed the total fee budget the host approved.
    const maximum = perTransaction * BigInt(MAX_RELAY_TRANSACTIONS);
    if (maximum > BigInt(request.maxRelayFeeWei)) fail();
    const notes = wallet.notes();
    if (notes.length > 4096) fail();
    const merges = consolidationCount(notes.map(n => BigInt(amountSchema.parse(String(n.v)))).filter(v => v > 0n), BigInt(request.amountWei), perTransaction);
    if (merges === null) fail();
    return { walletFingerprint, relayFeeWei: relay.fee, totalRelayFeeWei: String(maximum), estimatedRelayFeeWei: String(perTransaction * BigInt(merges + 1)), maximumRelayTransactions: 8 as const, consolidationTransactions: merges, recipient };
  }
  function storedOperation(context: TacitContext, ref: string) {
    binding(context);
    const op = operations.get(operationRefSchema.parse(ref));
    if (!op || keyOf(op.result) !== keyOf(context)) fail();
    return op;
  }
  async function reconcile(op: StoredOperation) {
    if (op.reconciling) return op.reconciling;
    if (!["submitted", "unknown"].includes(op.result.state)) return cloned(op.result);
    const run = async () => {
      const b = binding(op.result);
      try {
        if (await b.getChainId() !== op.result.chainId) fail();
        const { state, transactionHash } = await b.confirm(cloned(op.quote.request), op.result.transactionHash, { operationRef: op.result.operationRef });
        if (!["confirmed", "failed", "unknown"].includes(state)) fail();
        if (transactionHash) op.result.transactionHash = hashSchema.parse(transactionHash);
        if (state === "confirmed" && !op.result.transactionHash) fail();
        op.result.state = state;
        await persist();
        if (state !== "unknown" && busy.get(keyOf(op.result)) === op.result.operationRef) busy.delete(keyOf(op.result));
      } catch { op.result.state = "unknown"; }
      if (op.result.state === "unknown") busy.set(keyOf(op.result), op.result.operationRef);
      return cloned(op.result);
    };
    op.reconciling = Promise.resolve().then(run);
    try { return await op.reconciling; } finally { op.reconciling = undefined; }
  }
  function receipt(context: TacitContext, ref: string) {
    binding(context);
    const r = receipts.get(receiptRefSchema.parse(ref));
    if (!r || keyOf(r.context) !== keyOf(context)) fail();
    return r;
  }

  async function pruneExpiredPlans() {
    const timestamp = now();
    for (const [ref, op] of operations) {
      // These states never reached proving/submission. Keep all financial
      // evidence, including failed/confirmed records and interrupted outcomes.
      if (!["awaiting_approval", "expired", "rejected"].includes(op.result.state)
        || op.quote.quote.expiresAt > timestamp || op.result.transactionHash
        || op.quote.planning || op.running || op.reconciling) continue;
      operations.delete(ref); quotes.delete(op.quote.quote.quoteRef);
      cleanupRevision++;
    }
    for (const [ref, quote] of quotes) {
      if (!quote.operationRef && !quote.planning && quote.quote.expiresAt <= timestamp) quotes.delete(ref);
    }
    if (cleanupRevision > savedCleanupRevision) {
      const revision = cleanupRevision;
      await persist();
      savedCleanupRevision = Math.max(savedCleanupRevision, revision);
    }
  }

  const tools: TacitToolBackend = {
    async getOptions() {
      return { wallets: [...bindings.values()].map(b => ({ walletRef: b.walletRef, chainId: b.chainId,
        canShield: !!b.canShield, canRelay: !!b.relayer, canReceiveDeposits: !!b.watchDepositAddress,
        canCreateReceipts: !!b.receipts, canVerifyReceipts: !!b.receipts })) };
    },
    getBalance: c => balance(c),
    async getReceiveAddress({ kind, ...c }) {
      const { wallet, b } = await open(c);
      if (kind === "deposit") {
        if (!b.watchDepositAddress) fail();
        await b.watchDepositAddress();
      }
      return { ...c, kind, address: kind === "shielded" ? poolAddressSchema.parse(b.validateRecipient(wallet.address)) : evmAddressSchema.parse(wallet.receive.address),
        ...(kind === "deposit" ? { collectionFeeBps: 25 } : {}) };
    },
    async quotePayment(input) {
      const request = paymentSchema.parse(input);
      await pruneExpiredPlans();
      if (quotes.size >= MAX_ENTRIES || busy.has(keyOf(request))) fail();
      const data = await quoteData(request);
      if (quotes.size >= MAX_ENTRIES || busy.has(keyOf(request))) fail();
      const quote = quoteSchema.parse({ ...request, ...data, asset: "ETH", quoteRef: opaque("quote"), expiresAt: now() + quoteLifetimeMs });
      quotes.set(quote.quoteRef, { request: { ...request, recipient: data.recipient }, quote, walletFingerprint: data.walletFingerprint });
      return cloned(quote);
    },
    async plan({ quoteRef, action, ...c }) {
      binding(c);
      await pruneExpiredPlans();
      const q = quotes.get(quoteRef);
      if (!q || keyOf(q.quote) !== keyOf(c) || q.quote.action !== action) fail();
      if (q.planning) return cloned(await q.planning);
      if (q.operationRef) return cloned(storedOperation(c, q.operationRef).result);
      if (q.quote.expiresAt <= now() || operations.size >= MAX_ENTRIES || busy.has(keyOf(c))) fail();
      const planning = (async () => {
        const result = operationSchema.parse({ ...c, quoteRef, action, operationRef: opaque("operation"), state: "awaiting_approval" });
        q.operationRef = result.operationRef;
        operations.set(result.operationRef, { quote: q, result });
        try { await persist(); } catch {
          operations.delete(result.operationRef); q.operationRef = undefined; fail();
        }
        return result;
      })();
      q.planning = planning;
      try { return cloned(await planning); } finally { if (q.planning === planning) q.planning = undefined; }
    },
    async getOperation({ operationRef, ...c }) { return reconcile(storedOperation(c, operationRef)); },
    async recover(c) {
      const active = busy.get(keyOf(c));
      if (active && operations.get(active)?.running) fail();
      const snapshot = await balance(c, true);
      if (active) await reconcile(storedOperation(c, active));
      return snapshot;
    },
    async createReceipt({ operationRef, ...c }) {
      const op = storedOperation(c, operationRef);
      await reconcile(op);
      const b = binding(c);
      if (!b.receipts || op.result.state !== "confirmed" || op.result.action !== "transfer" || !op.result.transactionHash || receipts.size >= MAX_ENTRIES) fail();
      const expected = { transactionHash: op.result.transactionHash, recipient: op.quote.request.recipient!, amountWei: op.quote.request.amountWei };
      const proof = await b.receipts.create(expected);
      const verified = await b.receipts.verify(proof, expected);
      if (!verified.verified || verified.transactionHash.toLowerCase() !== expected.transactionHash.toLowerCase()) fail();
      const receiptRef = opaque("receipt");
      const output = { ...c, receiptRef, ...expected, verified: true };
      receipts.set(receiptRef, { context: c, proof: cloned(proof), public: output });
      return output;
    },
    async verifyReceipt({ receiptRef, recipient, amountWei, ...c }) {
      const r = receipt(c, receiptRef), b = binding(c);
      if (!b.receipts) fail();
      const expected = { recipient: poolAddressSchema.parse(b.validateRecipient(recipient)), amountWei: positiveAmountSchema.parse(amountWei) };
      const result = await b.receipts.verify(cloned(r.proof), expected);
      return { ...c, receiptRef, ...expected, transactionHash: hashSchema.parse(result.transactionHash), verified: result.verified === true };
    },
  };

  return {
    tools,
    async approveAndExecute({ operationRef, ...c }, approve) {
      const op = storedOperation(c, operationRef);
      if (op.running) return op.running;
      if (op.result.state !== "awaiting_approval") return reconcile(op);
      const run = async (): Promise<TacitOperation> => {
        const review = cloned(op.quote.quote);
        if (review.expiresAt <= now()) { op.result.state = "expired"; return cloned(op.result); }
        if (busy.has(keyOf(c))) fail();
        busy.set(keyOf(c), operationRef);
        let started = false;
        try {
          if (await approve(Object.freeze(cloned(review))) !== true) { op.result.state = "rejected"; return cloned(op.result); }
          if (review.expiresAt <= now()) { op.result.state = "expired"; return cloned(op.result); }
          // Recheck chain, recipient and current fees after the approval UI resolves.
          const current = await quoteData(op.quote.request);
          if (BigInt(current.relayFeeWei) > BigInt(review.relayFeeWei)
            || BigInt(current.totalRelayFeeWei) > BigInt(review.totalRelayFeeWei)
            || current.recipient !== review.recipient
            || current.walletFingerprint !== op.quote.walletFingerprint) { op.result.state = "expired"; return cloned(op.result); }
          const { wallet } = await open(c);
          if (review.expiresAt <= now()) { op.result.state = "expired"; return cloned(op.result); }
          op.result.state = "proving";
          await persist(); // Must be durable before any call that can prove/sign/submit.
          started = true;
          // Never forward free-form onStep messages, proofs, witnesses or exceptions to the model.
          const request = op.quote.request;
          const options = { via: "relay" as const, maxFee: BigInt(review.relayFeeWei) };
          const hash = request.action === "shield" ? await wallet.deposit(BigInt(request.amountWei))
            : request.action === "transfer" ? await wallet.send(request.recipient!, BigInt(request.amountWei), options)
              : await wallet.withdraw(request.recipient!, BigInt(request.amountWei), options);
          op.result.transactionHash = hashSchema.parse(hash);
          op.result.state = "submitted";
          await persist();
          return await reconcile(op);
        } catch {
          op.result.state = started ? "unknown" : "failed";
          return cloned(op.result);
        } finally {
          let storageFailed = false;
          try { await persist(); } catch {
            storageFailed = true;
            op.result.state = started ? "unknown" : "failed";
            if (started) busy.set(keyOf(c), operationRef);
          }
          if (!["unknown", "submitted", "proving"].includes(op.result.state) && busy.get(keyOf(c)) === operationRef) busy.delete(keyOf(c));
          if (storageFailed) fail();
        }
      };
      // Assign before executing any approval callback, making concurrent calls idempotent.
      op.running = Promise.resolve().then(run);
      try { return await op.running; } finally { op.running = undefined; }
    },
    importReceipt(c, proof) {
      binding(c);
      if (!bindings.get(keyOf(c))?.receipts || receipts.size >= MAX_ENTRIES) fail();
      const receiptRef = opaque("receipt");
      receipts.set(receiptRef, { context: cloned(c), proof: cloned(proof) });
      return receiptRef;
    },
    async exportReceiptForUser({ receiptRef, ...c }, approve) {
      const r = receipt(c, receiptRef);
      if (await approve() !== true) fail();
      return cloned(r.proof);
    },
  };
}
