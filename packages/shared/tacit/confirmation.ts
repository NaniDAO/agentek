import { decodeEventLog, parseAbiItem, toEventSelector, zeroAddress, type Hex } from "viem";
import { z } from "zod";
import { TACIT_POOL, chainSchema, evmAddressSchema, hashSchema, operationRefSchema } from "./schemas.js";

const event = parseAbiItem("event Transact(bytes32 indexed nf0,bytes32 indexed nf1,bytes32 outLeaf0,bytes32 outLeaf1,uint256 firstIndex,bytes32 newRoot,address recipient,int256 extAmount,address relayer,uint256 fee,bytes memo0,bytes memo1)");
const fields = ["nf0", "nf1", "outLeaf0", "outLeaf1", "recipient", "extAmount", "relayer", "fee", "memo0", "memo1"] as const;
const integer = z.string().regex(/^(0x[0-9a-fA-F]{1,64}|-?[0-9]{1,78})$/);
const address = z.string().refine(v => v.toLowerCase() === zeroAddress || evmAddressSchema.safeParse(v).success);
const eventArgs = z.object({ nf0: hashSchema, nf1: hashSchema, outLeaf0: hashSchema, outLeaf1: hashSchema,
  recipient: address, extAmount: z.bigint(), relayer: address, fee: z.bigint(),
  memo0: z.string(), memo1: z.string() }).strip();
export const tacitSubmissionSchema = z.object({
  operationRef: operationRefSchema, chainId: chainSchema, fromBlock: integer,
  transactionHash: hashSchema.optional(),
  /** True only for a hash independently computed from the host's own signed transaction, never a keeper claim. */
  trustedTransactionHash: z.boolean().optional(),
  tx: z.object({ nf0: integer, nf1: integer, outLeaf0: integer, outLeaf1: integer,
    recipient: address, extAmount: integer, relayer: address, fee: integer,
    memo0: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(132), memo1: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(132),
  }).strip(),
}).strict();
export type TacitSubmission = z.infer<typeof tacitSubmissionSchema>;
export interface TacitSubmissionConfirmation {
  state: "confirmed" | "failed" | "unknown";
  transactionHash?: string;
  /** Durable resume point for exact-event discovery; never replace submission.fromBlock. */
  nextScanBlock?: string;
}

/** Host-only evidence, recorded durably BEFORE submitting. No note openings or spending keys. */
export async function confirmTacitSubmission({ submission: input, rpc, confirmations, scanFromBlock }: {
  submission: TacitSubmission; rpc(method: string, params?: unknown[]): Promise<any>; confirmations: number;
  /** Previously returned nextScanBlock, stored by the trusted host with this submission. */
  scanFromBlock?: string;
}): Promise<TacitSubmissionConfirmation> {
  const s = tacitSubmissionSchema.parse(input);
  const originalStart = BigInt(s.fromBlock);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1000 || originalStart < 0n) throw new Error("Invalid confirmation policy.");
  const cursor = scanFromBlock === undefined ? originalStart : BigInt(integer.parse(scanFromBlock));
  if (cursor < originalStart) throw new Error("Invalid confirmation scan progress.");
  const unknown = { state: "unknown" as const, ...(s.transactionHash ? { transactionHash: s.transactionHash } : {}) };
  if (BigInt(await rpc("eth_chainId")) !== BigInt(s.chainId)) return unknown;
  const head = BigInt(await rpc("eth_blockNumber"));
  const matches = (log: any) => {
    if (String(log.address).toLowerCase() !== TACIT_POOL.toLowerCase() || log.removed === true) return false;
    try {
      const decoded = z.object({ args: eventArgs }).parse(decodeEventLog({ abi: [event], data: log.data as Hex, topics: log.topics, strict: true })).args;
      return fields.every(field => ["recipient", "relayer", "memo0", "memo1"].includes(field)
        ? String(decoded[field]).toLowerCase() === s.tx[field].toLowerCase()
        : BigInt(decoded[field]) === BigInt(s.tx[field]));
    } catch { return false; }
  };
  async function inspect(hash: string): Promise<TacitSubmissionConfirmation> {
    const unresolved = { state: "unknown" as const, transactionHash: hash };
    try {
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (!receipt || String(receipt.transactionHash).toLowerCase() !== hash.toLowerCase()
        || !hashSchema.safeParse(receipt.blockHash).success) return unresolved;
      const block = BigInt(receipt.blockNumber);
      if (block < originalStart || head < block + BigInt(confirmations)) return unresolved;
      const canonical = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (canonical?.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return unresolved;
      if (receipt.status === "0x1" && Array.isArray(receipt.logs) && receipt.logs.length <= 4096 && receipt.logs.some(matches)) {
        return { state: "confirmed", transactionHash: hash };
      }
      if (receipt.status === "0x0" && s.trustedTransactionHash === true
        && s.transactionHash?.toLowerCase() === hash.toLowerCase()) {
        // Only the trusted host's signed transaction hash commits the exact
        // sender/value/call. A keeper can replay even the identical proof into
        // a reverted transaction while another broadcast succeeds or is pending.
        return { state: "failed", transactionHash: hash };
      }
    } catch { /* Unavailable/malformed RPC data is never failure evidence. */ }
    return unresolved;
  }
  const hint = s.transactionHash ? await inspect(s.transactionHash) : unknown;
  if (hint.state === "confirmed") return hint;

  // Scan confirmed ranges even when the keeper supplied a wrong/missing hash.
  // Each call is bounded; a durable cursor allows arbitrarily old submissions
  // to be recovered over subsequent checks rather than permanently refusing.
  const safeHead = head - BigInt(confirmations);
  const resume = cursor > head + 1n ? originalStart : cursor;
  const overlap = resume - BigInt(confirmations);
  let next = overlap > originalStart ? overlap : originalStart;
  const end = next + 99_999n < safeHead ? next + 99_999n : safeHead;
  const word = (n: string) => "0x" + BigInt(n).toString(16).padStart(64, "0");
  while (next <= end) {
    const through = next + 1_999n < end ? next + 1_999n : end;
    let logs: unknown;
    try {
      logs = await rpc("eth_getLogs", [{ address: TACIT_POOL,
        topics: [toEventSelector(event), word(s.tx.nf0), word(s.tx.nf1)],
        fromBlock: "0x" + next.toString(16), toBlock: "0x" + through.toString(16) }]);
    } catch { return { ...unknown, nextScanBlock: String(next) }; }
    if (!Array.isArray(logs) || logs.length > 4096) return { ...unknown, nextScanBlock: String(next) };
    const found = logs.find(matches);
    if (found && hashSchema.safeParse(found.transactionHash).success) {
      const result = await inspect(found.transactionHash);
      if (result.state === "confirmed") return result;
      // Do not advance past evidence that has not become canonical yet.
      return { ...unknown, nextScanBlock: String(next) };
    }
    next = through + 1n;
  }
  if (hint.state === "failed" && next > safeHead) return hint;
  return { ...unknown, nextScanBlock: String(next) };
}
