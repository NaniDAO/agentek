import type { Connection, Keypair, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { SolanaExecutionError, type AgentekClient, type SolanaConfig, type SolanaExecutionRecord, type SolanaExecutionResult } from "../client.js";
import { wireValue } from "../utils/wire.js";
import { decodeBase58, encodeBase58 } from "./base58.js";

/** Opt in to the SDK-backed signing runtime; importing core never loads it. */
export function createSolanaConfig(config: SolanaConfig = {}): SolanaConfig {
  const settings: SolanaConfig = {...config};
  settings.createRuntime = (client, observer) => new SolanaRuntime(client, settings, observer);
  return settings;
}

const SOLANA_RPC_OUTCOME_TIMEOUT_MS = 120_000;

type RpcStageResult<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

/**
 * Bound an RPC stage without pretending cancellation occurred. The underlying
 * request may still finish, so callers receive the locally-derived signature
 * and an explicit ambiguous status rather than a retryable timeout error.
 */
async function awaitSolanaRpcStage<T>(
  promise: Promise<T>,
  timeoutMs = SOLANA_RPC_OUTCOME_TIMEOUT_MS,
): Promise<RpcStageResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RpcStageResult<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "timeout" }),
      timeoutMs,
    );
  });
  const outcome: Promise<RpcStageResult<T>> = promise.then(
    (value): RpcStageResult<T> => ({ kind: "value", value }),
    (error): RpcStageResult<T> => ({ kind: "error", error }),
  );
  try {
    return await Promise.race([outcome, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Accepts base58, a JSON byte array, or raw bytes. */
function toSolanaSecretKey(
  privateKey: string | number[] | Uint8Array,
): Uint8Array {
  if (privateKey instanceof Uint8Array) return privateKey;
  if (Array.isArray(privateKey)) return Uint8Array.from(privateKey);

  const trimmed = privateKey.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  // A 64-byte ed25519 secret is at most 88 base58 characters. Bound the
  // attacker-controlled text before the quadratic decoder runs.
  if (trimmed.length > 88) {
    throw new Error("Invalid Solana private key - base58 value is too long");
  }
  return decodeBase58(trimmed);
}

class SolanaRuntime {
  private solanaConnection?: Connection;
  private solanaKeypair?: Keypair;
  private solanaOutcomeUnknown = false;
  private solanaExecutionQueue: Promise<unknown> = Promise.resolve();
  constructor(private client: AgentekClient, private config: SolanaConfig, private solanaObserver?: (record: SolanaExecutionRecord) => void | Promise<void>) {}
  public async getSolanaConnection(): Promise<Connection> {
    if (!this.solanaConnection) {
      const { Connection } = await import("@solana/web3.js");
      this.solanaConnection = new Connection(
        this.client.getSolanaRpcUrl(),
        "confirmed",
      );
    }
    return this.solanaConnection;
  }

  /** The Solana signer, or undefined when the client is watch-only. */
  public async getSolanaKeypair(): Promise<Keypair | undefined> {
    if (this.solanaKeypair) return this.solanaKeypair;

    const privateKey = this.config?.privateKey;
    if (!privateKey) return undefined;

    const { Keypair } = await import("@solana/web3.js");
    this.solanaKeypair = Keypair.fromSecretKey(toSolanaSecretKey(privateKey));
    return this.solanaKeypair;
  }

  /** Compile instructions into an unsigned v0 transaction paid for by the configured account. */
  public async buildSolanaTransaction(
    instructions: TransactionInstruction[],
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const { PublicKey, TransactionMessage, VersionedTransaction } =
      await import("@solana/web3.js");

    const connection = await this.getSolanaConnection();
    const payerKey = new PublicKey(await this.client.getSolanaAddress());
    const { blockhash, lastValidBlockHeight } = await this.awaitSolanaPreSubmission(
      connection.getLatestBlockhash(),
      "getLatestBlockhash",
    );

    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(message),
      blockhash,
      lastValidBlockHeight,
    };
  }

  /** Bound RPC work before signing, where an ordinary retry is still safe. */
  public async awaitSolanaPreSubmission<T>(
    promise: Promise<T>,
    label: string,
  ): Promise<T> {
    const outcome = await awaitSolanaRpcStage(promise);
    if (outcome.kind === "timeout") {
      throw new Error(
        `Solana RPC ${label} timed out before transaction signing; it is safe to retry`,
      );
    }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  }

  /** Sign, submit and confirm a Solana transaction. Throws when the client is watch-only. */
  public async executeSolanaTransaction(
    transaction: VersionedTransaction,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<SolanaExecutionResult> {
    const previous = this.solanaExecutionQueue;
    const next = previous.catch(() => undefined).then(() => this.submitSolanaTransaction(transaction, blockhash, lastValidBlockHeight));
    this.solanaExecutionQueue = next;
    return next;
  }

  private async submitSolanaTransaction(
    transaction: VersionedTransaction, blockhash: string, lastValidBlockHeight: number,
  ): Promise<SolanaExecutionResult> {
    if (this.client.getExecutionMode() === "prepare") throw new Error("Client is in prepare mode");
    if (this.solanaOutcomeUnknown) throw new Error("Reconcile the earlier Solana signature before submitting another transaction");
    if (!this.solanaObserver) throw new Error("Durable onSolanaExecutionUpdated persistence is required before signing");
    const keypair = await this.getSolanaKeypair();
    if (!keypair) {
      throw new Error(
        "No Solana signer available - pass solana.privateKey to send transactions",
      );
    }

    const connection = await this.getSolanaConnection();
    if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0 || blockhash !== transaction.message.recentBlockhash) throw new Error("Solana confirmation lifetime does not match the transaction");
    const unsigned = new Uint8Array(transaction.serialize());
    const { VersionedTransaction } = await import("@solana/web3.js");
    const capturedTransaction = VersionedTransaction.deserialize(unsigned);
    const [genesisHash, fee] = await Promise.all([
      this.awaitSolanaPreSubmission(connection.getGenesisHash(), "getGenesisHash"),
      this.awaitSolanaPreSubmission(connection.getFeeForMessage(capturedTransaction.message), "getFeeForMessage"),
    ]);
    if (!Number.isSafeInteger(fee?.value) || fee.value < 0 || fee.value > 10_000_000) throw new Error("Solana fee is unknown or exceeds the 0.01 SOL fee ceiling");
    await this.client.authorizeAction("solana_transaction", { transaction: Buffer.from(unsigned).toString("base64"), genesisHash, feeLamports: String(fee.value), blockhash, lastValidBlockHeight });
    if (Buffer.from(transaction.serialize()).toString("base64") !== Buffer.from(unsigned).toString("base64")) throw new Error("Solana transaction changed during approval");
    transaction.sign([keypair]);

    // The signature is deterministic and already present locally. Preserve it
    // across every RPC failure so callers can reconcile instead of rebuilding
    // with a new blockhash and accidentally paying twice.
    const signature = encodeBase58(transaction.signatures[0]);
    const signedBytes = new Uint8Array(transaction.serialize());
    const record: SolanaExecutionRecord = { id: signature, signature, transaction: Buffer.from(signedBytes).toString("base64"), status: "signed", account: keypair.publicKey.toBase58(), genesisHash, blockhash, lastValidBlockHeight };
    const save = async () => {
      try { await this.solanaObserver!(wireValue(record)); }
      catch { throw new SolanaExecutionError("Solana persistence failed; reconcile the stored signature before retrying", wireValue(record)); }
    };
    // Even a failed persistence callback can have written durable state or
    // exposed signed bytes. Keep this client locked until reconciliation.
    this.solanaOutcomeUnknown = true;
    await save();
    record.status = "unknown";
    await save();

    const executionStartedAt = Date.now();
    const sendOutcome = await awaitSolanaRpcStage(
      connection.sendRawTransaction(
        signedBytes,
        { maxRetries: 3 },
      ),
    );
    if (sendOutcome.kind === "timeout") {
      return { signature, confirmationStatus: "unknown" };
    }
    if (sendOutcome.kind === "error") {
      // web3.js uses SendTransactionError for every send RPC error, including
      // unavailable nodes and "already processed" responses. Its class (or
      // action=simulate message) does not prove that no submission occurred.
      return { signature, confirmationStatus: "unknown" };
    }
    const rpcSignature = sendOutcome.value;

    if (rpcSignature !== signature) {
      // A conforming RPC returns the transaction's first signature. Treat a
      // mismatch as an ambiguous submission and retain the locally verifiable
      // identity rather than trusting RPC-controlled output.
      return { signature, confirmationStatus: "unknown" };
    }
    record.status = "submitted"; await save();

    const confirmationOutcome = await awaitSolanaRpcStage(
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      ),
      Math.max(
        1,
        SOLANA_RPC_OUTCOME_TIMEOUT_MS - (Date.now() - executionStartedAt),
      ),
    );
    if (confirmationOutcome.kind !== "value") {
      return { signature, confirmationStatus: "submitted" };
    }
    const confirmation = confirmationOutcome.value;
    const confirmationError = confirmation?.value?.err;
    if (confirmationError === undefined || (confirmationError !== null && typeof confirmationError !== "object" && typeof confirmationError !== "string")) return { signature, confirmationStatus: "submitted" };
    if (confirmationError !== null) {
      record.status = "failed"; await save(); this.solanaOutcomeUnknown = false;
      throw new SolanaExecutionError("Solana transaction failed; reconcile fees and effects before retrying", wireValue(record));
    }
    record.status = "confirmed"; await save(); this.solanaOutcomeUnknown = false;
    return { signature, confirmationStatus: "confirmed" };
  }

}
