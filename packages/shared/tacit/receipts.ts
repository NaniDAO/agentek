import { z } from "zod";
import { decodeEventLog, encodeAbiParameters, getAddress, keccak256, parseAbiItem, zeroAddress, type Hex } from "viem";
import { TACIT_POOL, chainSchema, hashSchema, poolAddressSchema, positiveAmountSchema } from "./schemas.js";
import type { TacitReceiptService } from "./types.js";

const event = parseAbiItem("event Transact(bytes32 indexed nf0, bytes32 indexed nf1, bytes32 outLeaf0, bytes32 outLeaf1, uint256 firstIndex, bytes32 newRoot, address recipient, int256 extAmount, address relayer, uint256 fee, bytes memo0, bytes memo1)");
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const rawReceiptSchema = z.object({
  version: z.literal(1), chainId: chainSchema, transactionHash: hashSchema,
  logIndex: z.number().int().min(0).max(4095), outputIndex: z.union([z.literal(0), z.literal(1)]),
  ephemeralKey: z.string().regex(/^[1-9][0-9]{0,77}$/).refine(v => BigInt(v) < (1n << 256n)),
}).strict();
const eventArgsSchema = z.object({ nf0: hashSchema, extAmount: z.bigint(), outLeaf0: hashSchema, outLeaf1: hashSchema,
  memo0: z.string().regex(/^0x([a-fA-F0-9]{2})*$/).max(132), memo1: z.string().regex(/^0x([a-fA-F0-9]{2})*$/).max(132),
}).strip();

/** Adapt Tacit's paymentKey / verifyPayment primitives, with keys closed over by the host. */
export interface TacitPaymentProofRuntime {
  deriveKey(input: { chainId: number; firstNullifier: bigint; outputIndex: 0 | 1; attempt: number }): bigint | Promise<bigint>;
  verify(input: { recipient: string; ephemeralKey: bigint; memo: string; leaf: bigint; asset: bigint }): bigint | null | Promise<bigint | null>;
  validateRecipient(recipient: string): string;
}
export interface TacitReceiptReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  /** Fetch the canonical block at this height, not a block by the receipt's hash. */
  getBlock(args: { blockNumber: bigint }): Promise<{ hash: string | null } | null>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    transactionHash: string; status: string; blockNumber: bigint; blockHash: string;
    logs: readonly { address: string; data: Hex; topics: readonly Hex[]; removed?: boolean }[];
  }>;
}

/**
 * Verifies selected-payment disclosures against confirmed on-chain Transact events.
 * Receipts contain a one-time disclosure key, so expose this service only through
 * createTacitBackend's opaque receipt vault, not directly as a model tool.
 */
export function createTacitReceiptService({ chainId, reader, runtime, confirmations = 3 }: {
  chainId: 1 | 8453; reader: TacitReceiptReader; runtime: TacitPaymentProofRuntime; confirmations?: number;
}): TacitReceiptService {
  chainSchema.parse(chainId);
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 1000) throw new Error("Invalid receipt confirmation depth.");
  const asset = BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }],
    [BigInt(chainId), getAddress(TACIT_POOL), zeroAddress]))) % FR;
  const unavailable = () => { throw new Error("Private payment receipt could not be verified."); };
  async function events(hash: string) {
    hashSchema.parse(hash);
    if (await reader.getChainId() !== chainId) unavailable();
    const [tx, head] = await Promise.all([reader.getTransactionReceipt({ hash: hash as Hex }), reader.getBlockNumber()]);
    if (tx.transactionHash.toLowerCase() !== hash.toLowerCase() || tx.status !== "success"
      || !hashSchema.safeParse(tx.blockHash).success || tx.blockNumber < 0n
      || tx.blockNumber + BigInt(confirmations - 1) > head || tx.logs.length > 4096) unavailable();
    const canonical = await reader.getBlock({ blockNumber: tx.blockNumber });
    const canonicalHash = hashSchema.safeParse(canonical?.hash);
    if (!canonicalHash.success || canonicalHash.data.toLowerCase() !== tx.blockHash.toLowerCase()) unavailable();
    const out: Array<{ index: number; args: ReturnType<typeof decode> }> = [];
    tx.logs.forEach((log, index) => {
      // Preserve receipt-array indexes when ignoring removed or malformed logs.
      if (log.address.toLowerCase() !== TACIT_POOL.toLowerCase()
        || (log.removed !== undefined && log.removed !== false)) return;
      try { out.push({ index, args: decode(log) }); } catch { /* Other events are not payment evidence. */ }
    });
    return out;
  }
  function decode(log: { data: Hex; topics: readonly Hex[] }) {
    const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
    return z.object({ args: eventArgsSchema }).parse(decoded).args;
  }
  function expected(input: { recipient: string; amountWei: string }) {
    return { recipient: poolAddressSchema.parse(runtime.validateRecipient(input.recipient)), amountWei: positiveAmountSchema.parse(input.amountWei) };
  }
  async function check(e: ReturnType<typeof decode>, outputIndex: 0 | 1, ephemeralKey: bigint, recipient: string) {
    if (e.extAmount !== 0n || BigInt(e.nf0) === 0n) return null;
    return runtime.verify({ recipient, ephemeralKey, memo: outputIndex === 0 ? e.memo0 : e.memo1,
      leaf: BigInt(outputIndex === 0 ? e.outLeaf0 : e.outLeaf1), asset });
  }
  return {
    async create(input) {
      const request = expected(input);
      for (const e of await events(input.transactionHash)) {
        if (e.args.extAmount !== 0n || BigInt(e.args.nf0) === 0n) continue;
        for (const outputIndex of [0, 1] as const) for (let attempt = 0; attempt < 16; attempt++) {
          const ephemeralKey = await runtime.deriveKey({ chainId, firstNullifier: BigInt(e.args.nf0), outputIndex, attempt });
          if (await check(e.args, outputIndex, ephemeralKey, request.recipient) === BigInt(request.amountWei)) {
            return rawReceiptSchema.parse({ version: 1, chainId, transactionHash: input.transactionHash,
              logIndex: e.index, outputIndex, ephemeralKey: String(ephemeralKey) });
          }
        }
      }
      return unavailable();
    },
    async verify(raw, input) {
      const proof = rawReceiptSchema.parse(raw), request = expected(input);
      if (proof.chainId !== chainId) return unavailable();
      const e = (await events(proof.transactionHash)).find(v => v.index === proof.logIndex);
      const amount = e && await check(e.args, proof.outputIndex, BigInt(proof.ephemeralKey), request.recipient);
      return { verified: amount !== null && amount !== undefined && amount === BigInt(request.amountWei), transactionHash: proof.transactionHash };
    },
  };
}
