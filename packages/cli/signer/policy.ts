import { parseEther } from "viem";
import type { PolicyConfig } from "./protocol.js";

export interface PolicyResult {
  allowed: boolean;
  needsApproval: boolean;
  reason?: string;
}

export interface TxRequest {
  chainId?: number;
  to?: string;
  value?: bigint | string;
  data?: string;
}

export function defaultPolicy(): PolicyConfig {
  return {
    maxValuePerTx: "0.1",
    allowedChains: [1, 8453, 42161, 137, 10],
    blockedContracts: [],
    allowedContracts: [],
    blockedFunctions: [],
    requireApproval: "above_threshold",
    approvalThresholdPct: 50,
  };
}

export function evaluatePolicy(policy: PolicyConfig, tx: TxRequest): PolicyResult {
  // 1. Chain check
  if (tx.chainId !== undefined && policy.allowedChains.length > 0) {
    if (!policy.allowedChains.includes(tx.chainId)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Chain ${tx.chainId} is not in the allowed list: [${policy.allowedChains.join(", ")}]`,
      };
    }
  }

  const to = tx.to?.toLowerCase();

  // 2. Blocked contracts
  if (to && policy.blockedContracts.length > 0) {
    if (policy.blockedContracts.includes(to)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Contract ${to} is blocked by policy`,
      };
    }
  }

  // 3. Allowed contracts (if non-empty, only allow those)
  if (to && policy.allowedContracts.length > 0) {
    if (!policy.allowedContracts.includes(to)) {
      return {
        allowed: false,
        needsApproval: false,
        reason: `Contract ${to} is not in the allowed list`,
      };
    }
  }

  // 4. Blocked function selectors
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

  // 5. Value cap
  const txValue = typeof tx.value === "string" ? BigInt(tx.value) : (tx.value ?? 0n);
  const maxValue = parseEther(policy.maxValuePerTx);

  if (txValue > maxValue) {
    return {
      allowed: false,
      needsApproval: false,
      reason: `Transaction value ${txValue} exceeds maximum ${maxValue} (${policy.maxValuePerTx} ETH)`,
    };
  }

  // 6. Approval logic
  if (policy.requireApproval === "always") {
    return { allowed: true, needsApproval: true };
  }

  if (policy.requireApproval === "above_threshold") {
    const threshold = (maxValue * BigInt(policy.approvalThresholdPct)) / 100n;
    if (txValue > threshold) {
      return { allowed: true, needsApproval: true };
    }
  }

  return { allowed: true, needsApproval: false };
}
