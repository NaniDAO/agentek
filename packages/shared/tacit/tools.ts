import { z } from "zod";
import { createTool, type BaseTool } from "../client.js";
import type { TacitToolBackend } from "./types.js";
import {
  contextSchema, actionSchema, positiveAmountSchema, amountSchema, poolAddressSchema,
  evmAddressSchema,
  quoteRefSchema, operationRefSchema, receiptRefSchema, paymentSchema,
  optionsSchema, balanceSchema, receiveSchema, quoteSchema, operationSchema, receiptSchema,
  PRIVACY, PRIVACY_LIMIT,
} from "./schemas.js";

/** Fixed errors prevent wallet/prover exceptions and validation diagnostics leaking secrets. */
export class TacitToolError extends Error {
  constructor(public readonly code: "TACIT_UNAVAILABLE" | "TACIT_INVALID_REQUEST" | "TACIT_INVALID_RESPONSE") {
    super(code === "TACIT_INVALID_REQUEST" ? "Invalid Tacit tool request." : code === "TACIT_INVALID_RESPONSE"
      ? "The private wallet returned an invalid response. Check the trusted wallet host."
      : "The private wallet could not complete this request. Check its status in the trusted wallet host.");
    this.name = "TacitToolError";
  }
}

export function tacitTools(backend: TacitToolBackend): BaseTool[] {
  function tool(name: string, description: string, parameters: z.AnyZodObject, result: z.ZodTypeAny, call: (args: any) => Promise<unknown>) {
    return createTool({ name, description, parameters, execute: async (_client, input) => {
      const args = parameters.safeParse(input);
      if (!args.success) throw new TacitToolError("TACIT_INVALID_REQUEST");
      let raw: unknown;
      try { raw = await call(args.data); } catch { throw new TacitToolError("TACIT_UNAVAILABLE"); }
      // Output schemas use strip() and construct a new object: never forward arbitrary backend fields/errors.
      let parsed: ReturnType<typeof result.safeParse>;
      try { parsed = result.safeParse(raw); } catch { throw new TacitToolError("TACIT_INVALID_RESPONSE"); }
      if (!parsed.success) throw new TacitToolError("TACIT_INVALID_RESPONSE");
      const value = parsed.data;
      if ((args.data.walletRef && value.walletRef !== args.data.walletRef) || (args.data.chainId && value.chainId !== args.data.chainId)
        || (args.data.operationRef && value.operationRef !== args.data.operationRef && name === "getPrivateOperationStatus")
        || (args.data.quoteRef && value.quoteRef !== args.data.quoteRef)
        || (args.data.receiptRef && value.receiptRef !== args.data.receiptRef)) throw new TacitToolError("TACIT_INVALID_RESPONSE");
      const intended = { intentShieldFunds: "shield", intentPrivateTransfer: "transfer", intentPrivateWithdraw: "withdraw" }[name];
      if ((intended && value.action !== intended) || (args.data.action && value.action !== args.data.action)
        || (args.data.kind && value.kind !== args.data.kind)
        || (args.data.amountWei && value.amountWei !== args.data.amountWei)
        || (args.data.maxRelayFeeWei && value.maxRelayFeeWei !== args.data.maxRelayFeeWei)
        || (name === "verifyPrivatePaymentReceipt" && value.recipient !== args.data.recipient)) throw new TacitToolError("TACIT_INVALID_RESPONSE");
      if (name === "getPrivateReceiveAddress" && !(value.kind === "shielded" ? poolAddressSchema : evmAddressSchema).safeParse(value.address).success) {
        throw new TacitToolError("TACIT_INVALID_RESPONSE");
      }
      return { schemaVersion: 1, ...value, ...(value.action ? { privacy: PRIVACY[value.action], privacyLimit: PRIVACY_LIMIT } : {}) };
    } });
  }
  // Keep paymentSchema's cross-field checks even when called directly, outside AgentekClient.execute.
  const quoteInput = contextSchema.extend({ action: actionSchema, amountWei: positiveAmountSchema,
    recipient: z.string().min(1).max(300).optional(), maxRelayFeeWei: amountSchema }).strict();
  const planInput = contextSchema.extend({ quoteRef: quoteRefSchema }).strict();
  const receiptInput = contextSchema.extend({ receiptRef: receiptRefSchema, recipient: poolAddressSchema, amountWei: positiveAmountSchema }).strict();
  return [
    tool("getPrivacyOptions", "List authorized Tacit wallets and configured private-ETH capabilities on Ethereum and Base. A selectedReceiptRef, when present, identifies the receipt the user imported in the native host for this wallet and chain; use that opaque reference for verification. Deposits and withdrawals are public; a relayed pool transfer hides sender, recipient and amount from chain observers. No keys or wallet signatures are returned.", z.object({}).strict(), optionsSchema, () => backend.getOptions()),
    tool("getPrivateBalance", "Synchronize the configured private wallet and return its ETH balance and scan coverage. Uses an opaque wallet reference, never a seed, signature or note. An incomplete scan is not a zero balance.", contextSchema, balanceSchema, a => backend.getBalance(a)),
    tool("getPrivateReceiveAddress", "Return the wallet's static tacit1 receiving address for private ETH (kind shielded), shared with other Tacit apps. Its pool lane receives private payments; it is not a public 0x deposit address. kind deposit instead returns a standing EVM deposit address whose payer, amount and time are public. Automatic deposit collection can charge up to 25 basis points (0.25%); collection is needed before spending. Never creates bearer gift links.", contextSchema.extend({ kind: z.enum(["shielded", "deposit"]) }).strict(), receiveSchema, a => backend.getReceiveAddress(a)),
    tool("quotePrivatePayment", "Quote shielding ETH, a private pool transfer, or a public withdrawal. Includes consolidation and total relay fees in wei, a short expiry and the route's privacy properties. Does not prove, sign or move funds.", quoteInput, quoteSchema, a => backend.quotePayment(paymentSchema.parse(a))),
    ...([ ["intentShieldFunds", "shield", "Prepare a deposit of ETH into your own private wallet. Funding account, amount and time are public."],
      ["intentPrivateTransfer", "transfer", "Prepare a relayed ETH payment to a validated tacit1 receiving address with a pool lane, or a compatible bp1 pool address. Sender, recipient and amount are hidden from chain observers inside the pool."],
      ["intentPrivateWithdraw", "withdraw", "Prepare a relayed ETH payout to an ordinary EVM address. Recipient, amount and time are public; which private note funds it is hidden."] ] as const)
      .map(([name, action, description]) => tool(name, `${description} Consumes a quote for this wallet and chain and returns an opaque intent. Only the trusted host can approve and execute; this tool never submits.`, planInput, operationSchema, a => backend.plan({ ...a, action }))),
    tool("getPrivateOperationStatus", "Read a private operation's status. Unknown or submitted is not confirmation; never automatically retry it. The host must reconcile against chain data.", contextSchema.extend({ operationRef: operationRefSchema }).strict(), operationSchema, a => backend.getOperation(a)),
    tool("recoverPrivateWallet", "Rebuild the private wallet's balance from chain logs rather than the relay's feed. Returns balance and scan coverage, never note openings, nullifiers or wallet secrets. Does not move funds.", contextSchema, balanceSchema, a => backend.recover(a)),
    tool("createPrivatePaymentReceipt", "Create an opaque receipt reference for a confirmed private transfer. Its raw payment disclosure stays in the trusted host; sharing it with a person requires separate host approval. No wallet secrets or bearer links are returned.", contextSchema.extend({ operationRef: operationRefSchema }).strict(), receiptSchema, a => backend.createReceipt(a)),
    tool("verifyPrivatePaymentReceipt", "Verify a receipt already imported into the trusted host against the expected recipient and exact amount in wei. Read the wallet's selectedReceiptRef from getPrivacyOptions after the user imports a receipt in the native host. Never accepts raw keys, notes or proof-disclosure secrets through the model.", receiptInput, receiptSchema, a => backend.verifyReceipt(a)),
  ];
}
