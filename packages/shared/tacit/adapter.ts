import type { TacitEvmWallet, TacitToolBackend } from "./types.js";
import { chainSchema, TACIT_POOL, TACIT_ROUTER } from "./schemas.js";

const POLICY = {
  1: { deployBlock: 26069245, relayer: "0x7c9f8aE4e48Cbb2727F95b6477a1cf92bCFc43D0", maxRelayFee: 50_000_000_000_000_000n },
  8453: { deployBlock: 51864014, relayer: "0xfA2afbaB631C7Eda7CeA6AE1440605C504E322Ec", maxRelayFee: 2_000_000_000_000_000n },
} as const;

/** Snarkjs object consumed by the real Tacit wallet's toTx adapter. */
export interface TacitCoreProof {
  proof: { pi_a: readonly string[]; pi_b: readonly (readonly string[])[]; pi_c: readonly string[] };
  publicSignals: readonly string[];
}

export interface TacitCoreSessionOptions {
  /** Tacit's actual makeEvmPoolWallet factory, supplied by the trusted host's pinned runtime. */
  createWallet(options: {
    zk: unknown; keys: unknown; prove: (input: unknown) => Promise<TacitCoreProof>; keeper: string;
    signer?: unknown; store?: unknown; fetchImpl?: typeof fetch;
    chain: { chainId: number; pool: string; router: string; deployBlock: number; relayer: string;
      maxRelayFee: bigint; rpc: (method: string, params?: unknown[]) => Promise<unknown>; confirmations: number };
  }): TacitCoreWallet;
  chainId: 1 | 8453;
  zk: unknown;
  keys: unknown;
  /** Local prover that verifies its output and checks proving artifacts against Tacit's pins. */
  prove(input: unknown): Promise<TacitCoreProof>;
  rpc(method: string, params?: unknown[]): Promise<unknown>;
  keeper: string;
  signer?: unknown;
  store?: unknown;
  fetchImpl?: typeof fetch;
  confirmations?: number;
}

/** Construct, rather than mutate, a core with explicit relayer pins even in Node (which has no browser origin). */
export function createTacitWalletSession(options: TacitCoreSessionOptions) {
  const chainId = chainSchema.parse(options.chainId), policy = POLICY[chainId];
  const keeper = new URL(options.keeper);
  if (keeper.protocol !== "https:" || keeper.username || keeper.password || keeper.hash) throw new Error("Use a configured HTTPS Tacit keeper.");
  const confirmations = options.confirmations ?? (chainId === 1 ? 3 : 10);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1000) throw new Error("Invalid Tacit confirmation depth.");
  const core = options.createWallet({
    zk: options.zk, keys: options.keys, prove: options.prove, keeper: options.keeper,
    signer: options.signer, store: options.store, fetchImpl: options.fetchImpl,
    chain: { chainId, pool: TACIT_POOL, router: TACIT_ROUTER, ...policy, rpc: options.rpc, confirmations },
  });
  return adaptTacitCoreWallet(core);
}

/** Tacit's unbundled makeEvmPoolWallet API. The host supplies its keys and local prover there. */
export interface TacitCoreWallet {
  address: string;
  receiveBox: string;
  sync(): ReturnType<TacitEvmWallet["sync"]>;
  rescan(): ReturnType<TacitEvmWallet["rescan"]>;
  notes(): ReturnType<TacitEvmWallet["notes"]>;
  waiting(): Promise<bigint>;
  watchReceive(): Promise<{ status: number; body: unknown }>;
  quote(): Promise<unknown>;
  deposit(args: { amount: bigint; onStep?: (step: string) => void }): Promise<string>;
  send(args: { to: string; amount: bigint; via: "relay"; maxFee: bigint }): Promise<string>;
  withdraw(args: { to: string; amount: bigint; via: "relay"; maxFee: bigint }): Promise<string>;
  sweep(): Promise<string>;
}

/** Reuses the real Tacit core without copying cryptography, note state or proving assets into Agentek. */
export function adaptTacitCoreWallet(core: TacitCoreWallet): {
  wallet: TacitEvmWallet; watchDepositAddress(): Promise<void>;
} {
  return {
    wallet: {
      address: core.address,
      // A keeper feed can omit memos/events while retaining a valid tree. Its
      // ordinary sync is an estimate; only a successful chain-only rescan
      // establishes the complete coverage this adapter can honestly report.
      sync: async () => ({ ...await core.sync(), complete: false }),
      rescan: async () => ({ ...await core.rescan(), complete: true }),
      notes: () => core.notes(), quote: () => core.quote(),
      receive: { address: core.receiveBox, waiting: () => core.waiting(), sweep: () => core.sweep() },
      deposit: (amount, options) => core.deposit({ amount, ...options }),
      send: (to, amount, options) => core.send({ to, amount, via: options.via, maxFee: options.maxFee }),
      withdraw: (to, amount, options) => core.withdraw({ to, amount, via: options.via, maxFee: options.maxFee }),
    },
    async watchDepositAddress() {
      const result = await core.watchReceive();
      if (!result || result.status < 200 || result.status >= 300) throw new Error("The deposit address could not be registered for collection.");
    },
  };
}

/** Only these read/prepare methods may cross a model-facing native-host bridge. No execution or key-export method exists. */
export type TacitHostRequest = { version: 1; method: keyof TacitToolBackend; params: unknown };
export function createTacitHostTransport(request: (message: TacitHostRequest) => Promise<unknown>): TacitToolBackend {
  const call = (method: keyof TacitToolBackend, params: unknown) => request({ version: 1, method, params });
  return {
    getOptions: () => call("getOptions", {}),
    getBalance: a => call("getBalance", a), getReceiveAddress: a => call("getReceiveAddress", a),
    quotePayment: a => call("quotePayment", a), plan: a => call("plan", a),
    getOperation: a => call("getOperation", a), recover: a => call("recover", a),
    createReceipt: a => call("createReceipt", a), verifyReceipt: a => call("verifyReceipt", a),
  };
}
