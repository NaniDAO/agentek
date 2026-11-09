import { z } from "zod";
import { getAddress, isAddress, zeroAddress } from "viem";

export const TACIT_POOL = "0x000000c2A20657CE25f2Ba99737933D031AFBEE9";
export const TACIT_ROUTER = "0x0000006C96Afa6f1cD4DF8FE19bc0d8B6A6Cd7B5";
export const chainSchema = z.union([z.literal(1), z.literal(8453)]);
export const walletRefSchema = z.string().regex(/^wallet_[A-Za-z0-9_-]{1,64}$/);
export const quoteRefSchema = z.string().regex(/^quote_[a-f0-9]{32}$/);
export const operationRefSchema = z.string().regex(/^operation_[a-f0-9]{32}$/);
export const receiptRefSchema = z.string().regex(/^receipt_[a-f0-9]{32}$/);
export const amountSchema = z.string().regex(/^(0|[1-9][0-9]{0,36})$/).refine(v => BigInt(v) < (1n << 120n));
export const positiveAmountSchema = amountSchema.refine(v => BigInt(v) > 0n);
export const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const evmAddressSchema = z.string().refine(v => isAddress(v, { strict: false }) && v.toLowerCase() !== zeroAddress)
  .transform(v => getAddress(v.toLowerCase()));
// Full network, checksum and curve validation is performed by the trusted Tacit runtime.
export const poolAddressSchema = z.string().min(20).max(300).regex(/^(bp1|tacit1)[023456789acdefghjklmnpqrstuvwxyz]+$/);
export const actionSchema = z.enum(["shield", "transfer", "withdraw"]);
export const stateSchema = z.enum(["awaiting_approval", "proving", "submitted", "confirmed", "failed", "unknown", "rejected", "expired"]);
export const contextSchema = z.object({ walletRef: walletRefSchema, chainId: chainSchema }).strict();
export const paymentSchema = contextSchema.extend({
  action: actionSchema,
  amountWei: positiveAmountSchema.describe("Exact ETH amount in wei, as a decimal integer string; 1 ETH = 1000000000000000000 wei."),
  recipient: z.string().min(1).max(300).optional(),
  maxRelayFeeWei: amountSchema.describe("Maximum total relay fees, including any consolidation transactions."),
}).strict().superRefine((v, ctx) => {
  if (v.action === "shield" ? v.recipient !== undefined : v.recipient === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Shielding has no recipient; transfers and withdrawals require one." });
  }
  if (v.recipient !== undefined && !(v.action === "transfer" ? poolAddressSchema : evmAddressSchema).safeParse(v.recipient).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a Tacit pool address for a private transfer, or a nonzero EVM address for withdrawal." });
  }
});

export const quoteSchema = contextSchema.extend({
  quoteRef: quoteRefSchema, action: actionSchema, asset: z.literal("ETH"), amountWei: positiveAmountSchema,
  recipient: z.union([evmAddressSchema, poolAddressSchema]).optional(),
  relayFeeWei: amountSchema, totalRelayFeeWei: amountSchema, maxRelayFeeWei: amountSchema,
  estimatedRelayFeeWei: amountSchema,
  maximumRelayTransactions: z.union([z.literal(0), z.literal(8)]),
  consolidationTransactions: z.number().int().min(0).max(7),
  expiresAt: z.number().int().nonnegative().safe(),
}).strip();
export const balanceSchema = contextSchema.extend({
  asset: z.literal("ETH"), balanceWei: amountSchema,
  syncedThroughBlock: z.number().int().nonnegative().safe(),
  complete: z.boolean(),
}).strip();
export const receiveSchema = contextSchema.extend({
  kind: z.enum(["shielded", "deposit"]), address: z.union([evmAddressSchema, poolAddressSchema]),
  collectionFeeBps: z.literal(25).optional(),
}).strip();
export const operationSchema = contextSchema.extend({
  operationRef: operationRefSchema, quoteRef: quoteRefSchema, action: actionSchema, state: stateSchema,
  transactionHash: hashSchema.optional(),
}).strip();
export const receiptSchema = contextSchema.extend({
  receiptRef: receiptRefSchema, transactionHash: hashSchema, recipient: poolAddressSchema,
  amountWei: positiveAmountSchema, verified: z.boolean(),
}).strip();
export const optionsSchema = z.object({
  wallets: z.array(contextSchema.extend({
    canShield: z.boolean(), canRelay: z.boolean(), canReceiveDeposits: z.boolean(), canCreateReceipts: z.boolean(), canVerifyReceipts: z.boolean(),
    selectedReceiptRef: receiptRefSchema.optional(),
  }).strip()).max(64),
}).strip();

export type TacitContext = z.infer<typeof contextSchema>;
export type TacitPayment = z.infer<typeof paymentSchema>;
export type TacitQuote = z.infer<typeof quoteSchema>;
export type TacitOperation = z.infer<typeof operationSchema>;
export type TacitBalance = z.infer<typeof balanceSchema>;
export type TacitReceipt = z.infer<typeof receiptSchema>;

export const PRIVACY = {
  shield: { public: ["funding wallet", "deposit amount", "deposit time"], hidden: ["owner of the created shielded note"] },
  transfer: { public: ["relayer", "relay fee", "transaction time"], hidden: ["sender", "recipient", "payment amount"] },
  withdraw: { public: ["recipient", "withdrawal amount", "relay fee", "transaction time"], hidden: ["which shielded note funded the withdrawal"] },
} as const;
export const PRIVACY_LIMIT = "Deposits and withdrawals remain public and may be correlated by amount and timing. Relayers and RPC providers can see network metadata. This does not guarantee anonymity.";
