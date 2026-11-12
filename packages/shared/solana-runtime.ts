/** Minimal optional runtime contract; core has no dependency on the Solana SDK. */
export interface SolanaSigner {
  publicKey: {toBase58(): string};
  secretKey: Uint8Array;
}
export interface SolanaTransaction {
  message: {recentBlockhash: string};
  signatures: Uint8Array[];
  serialize(): Uint8Array;
}
export interface SolanaRuntime {
  getSolanaConnection(): Promise<unknown>;
  getSolanaKeypair(): Promise<SolanaSigner | undefined>;
  buildSolanaTransaction(instructions: unknown[]): Promise<{transaction: SolanaTransaction; blockhash: string; lastValidBlockHeight: number}>;
  awaitSolanaPreSubmission<T>(promise: Promise<T>, label: string): Promise<T>;
  executeSolanaTransaction(transaction: SolanaTransaction, blockhash: string, lastValidBlockHeight: number): Promise<{signature: string; confirmationStatus: "confirmed" | "submitted" | "unknown"}>;
}
