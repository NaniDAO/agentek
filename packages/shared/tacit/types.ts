import type { TacitContext, TacitPayment, TacitQuote, TacitOperation } from "./schemas.js";

/** Trusted host interface. Implementations and wallet instances must never be serialized to a model. */
export interface TacitToolBackend {
  getOptions(): Promise<unknown>;
  getBalance(context: TacitContext): Promise<unknown>;
  getReceiveAddress(context: TacitContext & { kind: "shielded" | "deposit" }): Promise<unknown>;
  quotePayment(request: TacitPayment): Promise<unknown>;
  plan(context: TacitContext & { quoteRef: string; action: TacitPayment["action"] }): Promise<unknown>;
  getOperation(context: TacitContext & { operationRef: string }): Promise<unknown>;
  recover(context: TacitContext): Promise<unknown>;
  createReceipt(context: TacitContext & { operationRef: string }): Promise<unknown>;
  verifyReceipt(context: TacitContext & { receiptRef: string; recipient: string; amountWei: string }): Promise<unknown>;
}

/** Structural adapter for Tacit's standalone EVM wallet, NOT a tool result. */
export interface TacitEvmWallet {
  address: string;
  sync(): Promise<{ balance: bigint; block: number; [key: string]: unknown }>;
  rescan(): Promise<{ balance: bigint; block: number; [key: string]: unknown }>;
  notes(): Array<{ v: string | bigint; [key: string]: unknown }>;
  receive: { address: string; waiting(): Promise<bigint>; sweep(options?: unknown): Promise<string> };
  quote(): Promise<unknown>;
  deposit(amountWei: bigint, options?: { onStep?: (step: string) => void }): Promise<string>;
  send(recipient: string, amountWei: bigint, options: { via: "relay"; maxFee: bigint; onStep?: (step: string) => void }): Promise<string>;
  withdraw(recipient: string, amountWei: bigint, options: { via: "relay"; maxFee: bigint; onStep?: (step: string) => void }): Promise<string>;
}

export interface TacitReceiptService {
  /** Raw proof stays in the host's receipt vault. Never returned by a tool. */
  create(payment: { transactionHash: string; recipient: string; amountWei: string }): Promise<unknown>;
  verify(proof: unknown, expected: { recipient: string; amountWei: string }): Promise<{ verified: boolean; transactionHash: string }>;
}

export interface TacitWalletBinding extends TacitContext {
  /** Already unlocked by the host; may contain secret material internally. */
  openWallet(): Promise<TacitEvmWallet>;
  /** Must check the public chain identity; readers must not trust a relay's status. */
  getChainId(): Promise<number>;
  /** Verify the intended operation against confirmed chain data, not just any successful tx. */
  confirm(payment: TacitPayment, transactionHash?: string, context?: { operationRef: string }): Promise<{
    state: "confirmed" | "failed" | "unknown"; transactionHash?: string;
  }>;
  /** Use Tacit's recipientOf / poolRecipient helpers to validate checksum, network and curve points. */
  validateRecipient(recipient: string): string;
  relayer?: { address: string; maxFeeWei: string };
  canShield?: boolean;
  /** Register the receive box for automatic collection before exposing it as a deposit address. */
  watchDepositAddress?(): Promise<void>;
  receipts?: TacitReceiptService;
}

export interface TacitHost {
  tools: TacitToolBackend;
  /** Host-only approval. No tool accepts an approved flag, signature, identity key or secret note. */
  approveAndExecute(context: TacitContext & { operationRef: string }, approve: (review: Readonly<TacitQuote>) => Promise<boolean>): Promise<TacitOperation>;
  importReceipt(context: TacitContext, proof: unknown): string;
  exportReceiptForUser(context: TacitContext & { receiptRef: string }, approve: () => Promise<boolean>): Promise<unknown>;
}

/** Host-owned atomic durable storage for one active coordinator per wallet. Contains payment metadata, never keys, notes or raw receipt disclosures. */
export interface TacitOperationStore {
  load(): unknown;
  /** Resolve only after the snapshot is durable, including when crossing a native bridge. */
  save(snapshot: unknown): void | Promise<void>;
}
