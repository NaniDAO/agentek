import { parseEther } from "viem";
import type { PolicyConfig } from "./protocol.js";

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
}

export function defaultPolicy(): PolicyConfig {
  return {
    maxValuePerTx: "0.1",
    allowedChains: [1, 8453, 42161, 137, 10],
    allowContractCreation: false,
    contracts: {},
    requireApproval: "above_threshold",
    approvalThresholdPct: 50,
  };
}

/** Migrate old policy format (blockedContracts/allowedContracts/blockedFunctions)
 *  to the new contract-centric format. */
export function migratePolicy(raw: Record<string, unknown>): PolicyConfig {
  // Already new format
  if ("contracts" in raw && typeof raw.contracts === "object" && raw.contracts !== null && !Array.isArray(raw.contracts)) {
    return raw as unknown as PolicyConfig;
  }

  const contracts: Record<string, string[]> = {};

  // Convert old allowedContracts → contracts with ["*"]
  const oldAllowed = raw.allowedContracts as string[] | undefined;
  if (Array.isArray(oldAllowed)) {
    for (const addr of oldAllowed) {
      contracts[addr.toLowerCase()] = ["*"];
    }
  }

  return {
    maxValuePerTx: (raw.maxValuePerTx as string) ?? "0.1",
    allowedChains: (raw.allowedChains as number[]) ?? [1],
    allowContractCreation: (raw.allowContractCreation as boolean) ?? false,
    contracts,
    requireApproval: (raw.requireApproval as PolicyConfig["requireApproval"]) ?? "above_threshold",
    approvalThresholdPct: (raw.approvalThresholdPct as number) ?? 50,
  };
}

export function evaluatePolicy(policy: PolicyConfig, tx: TxRequest): PolicyResult {
  // 1. Chain check
  const chainId = tx.chainId;
  if (!Number.isInteger(chainId) || (chainId as number) <= 0) {
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

  // 3. Value cap — hard reject, no approval can override
  const txValue = typeof tx.value === "string" ? BigInt(tx.value) : (tx.value ?? 0n);
  const maxValue = parseEther(policy.maxValuePerTx);

  if (txValue > maxValue) {
    return {
      allowed: false,
      needsApproval: false,
      reason: `Transaction value ${txValue} exceeds maximum ${maxValue} (${policy.maxValuePerTx} ETH)`,
    };
  }

  // 4. Approval logic
  if (policy.requireApproval === "always") {
    return { allowed: true, needsApproval: true };
  }

  if (policy.requireApproval === "never") {
    return { allowed: true, needsApproval: false };
  }

  // 5. "above_threshold" mode: check contract allowlist + value threshold
  // Value above threshold always needs approval
  const threshold = (maxValue * BigInt(policy.approvalThresholdPct)) / 100n;
  if (txValue > threshold) {
    return { allowed: true, needsApproval: true };
  }

  // 6. Contract+function allowlist check
  //    If the target contract is in the map and the function is approved → no approval
  //    Otherwise → needs approval (passphrase)
  if (to && policy.contracts) {
    const contractEntry = policy.contracts[to];
    if (contractEntry) {
      // Contract is in the allowlist — check function
      if (contractEntry.includes("*")) {
        return { allowed: true, needsApproval: false };
      }
      // Check function selector
      if (tx.data && tx.data.length >= 10) {
        const selector = tx.data.slice(0, 10).toLowerCase();
        if (contractEntry.includes(selector)) {
          return { allowed: true, needsApproval: false };
        }
      }
      // Plain ETH transfer to approved contract (no data) — needs approval
      // unless contract has ["*"]
    }
  }

  // Not in allowlist → needs approval
  return { allowed: true, needsApproval: true };
}
