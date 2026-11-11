import { z } from "zod";
import { parseExactUnits } from "@agentek/tools/client";
import type { PolicyConfig } from "./protocol.js";


const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const exactAmount = z.string().refine(v => { try { return parseExactUnits(v, 18) >= 0n; } catch { return false; } }, "Invalid nonnegative exact ETH amount");
export const policySchema = z.object({
  maxValuePerTx: exactAmount,
  maxValuePerSession: exactAmount.optional(),
  allowedChains: z.array(z.number().int().positive().safe()),
  allowContractCreation: z.boolean().default(false),
  blockedContracts: z.array(address).default([]), allowedContracts: z.array(address).default([]),
  blockedFunctions: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/).transform(v => v.toLowerCase())).default([]),
  contracts: z.record(address, z.array(z.string().regex(/^(\*|0x[0-9a-fA-F]{8})$/).transform(v => v.toLowerCase()))).optional(),
  requireApproval: z.enum(["always", "above_threshold", "never"]),
  approvalThresholdPct: z.number().int().min(0).max(100),
}).strict();
export function validatePolicy(policy: unknown): PolicyConfig { return policySchema.parse(policy) as PolicyConfig; }

export interface PolicyResult {
  allowed: boolean;
  needsApproval: boolean;
  reason?: string;
}

export interface TxRequest {
  chainId?: number | null;
  to?: string | null;
  value?: bigint | string;
  data?: string;
  gas?: bigint | string;
  gasPrice?: bigint | string;
  maxFeePerGas?: bigint | string;
  maxPriorityFeePerGas?: bigint | string;
}

export function defaultPolicy(): PolicyConfig {
  return {
    maxValuePerTx: "0.1",
    maxValuePerSession: "0.1",
    allowedChains: [1, 8453, 42161, 137, 10],
    allowContractCreation: false,
    blockedContracts: [],
    allowedContracts: [],
    blockedFunctions: [],
    requireApproval: "above_threshold",
    approvalThresholdPct: 50,
  };
}

export function evaluatePolicy(policy: PolicyConfig, tx: TxRequest): PolicyResult {
  policy = validatePolicy(policy);
  // 1. Chain check
  const chainId = tx.chainId;
  if (!Number.isSafeInteger(chainId) || (chainId as number) <= 0) {
    return {
      allowed: false,
      needsApproval: false,
      reason: "Transaction chainId is required and must be a positive integer",
    };
  }
  const normalizedChainId = chainId as number;
  if (policy.allowedChains.length > 0 && !policy.allowedChains.includes(normalizedChainId)) {
    return {
      allowed: false,
      needsApproval: false,
      reason: `Chain ${normalizedChainId} is not in the allowed list: [${policy.allowedChains.join(", ")}]`,
    };
  }

  const hasExplicitTo = tx.to !== undefined && tx.to !== null;
  const isContractCreation = !hasExplicitTo;
  const to = typeof tx.to === "string" ? tx.to.toLowerCase() : undefined;
  const allowContractCreation = policy.allowContractCreation ?? false;

  // 2. Contract creation
  if (isContractCreation && !allowContractCreation) {
    return {
      allowed: false,
      needsApproval: false,
      reason: "Contract creation is disabled by policy",
    };
  }

  // 3. Blocked contracts
  if (to && policy.blockedContracts.length > 0) {
    if (policy.blockedContracts.includes(to)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Contract ${to} is blocked by policy`,
      };
    }
  }

  // 4. Allowed contracts (if non-empty, only allow those)
  if (to && policy.allowedContracts.length > 0) {
    if (!policy.allowedContracts.includes(to)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Contract ${to} is not in the allowed list`,
      };
    }
  }

  // 5. Blocked function selectors
  if (tx.data && tx.data.length >= 10 && policy.blockedFunctions.length > 0) {
    const selector = tx.data.slice(0, 10).toLowerCase();
    if (policy.blockedFunctions.includes(selector)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Function selector ${selector} is blocked by policy`,
      };
    }
  }

  // 6. Value cap
  const txValue = nativeLiability(tx);
  const maxValue = parseExactUnits(policy.maxValuePerTx, 18);

  if (txValue > maxValue) {
    return {
      allowed: false,
      needsApproval: false,
      reason: `Transaction native liability (value + maximum execution fee) ${txValue} exceeds maximum ${maxValue} (${policy.maxValuePerTx} ETH units)`,
    };
  }

  // These chains use the execution-gas fee model accounted for here. Other
  // chains (including rollups with L1 data/operator charges) require review:
  // gas * feePerGas is not a universal upper bound on their total charge.
  if (![1, 137, 11155111].includes(normalizedChainId)) {
    return { allowed: true, needsApproval: true, reason: "Additional chain fees are not bounded by this signer; review the chain's total native charge" };
  }

  // 7. Approval logic
  if (policy.requireApproval === "always") {
    return { allowed: true, needsApproval: true };
  }

  if (policy.requireApproval === "above_threshold") {
    const threshold = (maxValue * BigInt(policy.approvalThresholdPct)) / 100n;
    if (txValue > threshold) {
      return { allowed: true, needsApproval: true };
    }
    const approved = to && policy.contracts && Object.prototype.hasOwnProperty.call(policy.contracts, to) ? policy.contracts[to] : [];
    const selector = tx.data && tx.data.length >= 10 ? tx.data.slice(0, 10).toLowerCase() : undefined;
    const preapproved = approved.includes("*") || (selector !== undefined && approved.includes(selector));
    // Empty calldata can invoke a contract's fallback/receive code. It does
    // not establish an EOA or bound the caller authority exercised by a call.
    return { allowed: true, needsApproval: !preapproved, ...(!preapproved ? { reason: "Recipient/function is not explicitly preapproved; even empty calldata can invoke contract fallback code" } : {}) };
  }

  return { allowed: true, needsApproval: false };
}

export function nativeLiability(tx: TxRequest): bigint {
  const amount = (value: bigint | string | undefined) => {
    if (value === undefined) return 0n;
    if (typeof value !== "bigint" && !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid exact native quantity");
    const result = BigInt(value);
    if (result < 0n || result >= 2n ** 256n) throw new Error("Native quantity out of range");
    return result;
  };
  return amount(tx.value) + amount(tx.gas) * amount(tx.maxFeePerGas ?? tx.gasPrice);
}
