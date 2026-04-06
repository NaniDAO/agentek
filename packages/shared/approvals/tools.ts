import { z } from "zod";
import type { Address } from "viem";
import { erc20Abi, formatUnits, maxUint256, encodeFunctionData } from "viem";
import type { AgentekClient, Intent } from "../client.js";
import { createTool } from "../client.js";
import {
  approvalChains,
  BLOCKSCOUT_ENDPOINTS,
  APPROVAL_TOPIC,
} from "./constants.js";

// ─── Blockscout v1 (Etherscan-compatible) log types ─────────────────

interface EtherscanLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

interface EtherscanLogsResponse {
  status: string;
  message: string;
  result: EtherscanLog[] | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function topicToAddress(topic: string): string {
  return "0x" + topic.slice(26).toLowerCase();
}

/**
 * Fetch all ERC-20 Approval event logs where `owner` is topic1.
 * Uses Blockscout's Etherscan-compatible getLogs API which supports
 * cross-contract topic filtering (unlike the v2 address/logs endpoint).
 */
async function fetchApprovalLogs(
  chainId: number,
  owner: string,
): Promise<EtherscanLog[]> {
  const base = BLOCKSCOUT_ENDPOINTS[chainId];
  if (!base) throw new Error(`Chain ${chainId} not supported for approval scanning`);

  const ownerPadded = "0x" + owner.slice(2).toLowerCase().padStart(64, "0");
  const allLogs: EtherscanLog[] = [];

  // Paginate (Blockscout returns up to 1000 per page)
  for (let page = 1; page <= 10; page++) {
    const url = new URL(base);
    url.searchParams.set("module", "logs");
    url.searchParams.set("action", "getLogs");
    url.searchParams.set("topic0", APPROVAL_TOPIC);
    url.searchParams.set("topic0_1_opr", "and");
    url.searchParams.set("topic1", ownerPadded);
    url.searchParams.set("fromBlock", "0");
    url.searchParams.set("toBlock", "latest");
    url.searchParams.set("page", String(page));
    url.searchParams.set("offset", "1000");

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Blockscout getLogs failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as EtherscanLogsResponse;
    if (data.status !== "1" || !data.result || data.result.length === 0) break;

    allLogs.push(...data.result);

    // If we got fewer than 1000, no more pages
    if (data.result.length < 1000) break;
  }

  return allLogs;
}

/**
 * Deduplicate logs to unique (token, spender) pairs.
 */
function deduplicateApprovals(
  logs: EtherscanLog[],
): Array<{ token: string; spender: string }> {
  const seen = new Map<string, { token: string; spender: string }>();

  for (const log of logs) {
    const token = log.address.toLowerCase();
    const spender = topicToAddress(log.topics[2]);
    const key = `${token}:${spender}`;
    if (!seen.has(key)) {
      seen.set(key, { token: log.address, spender });
    }
  }

  return Array.from(seen.values());
}

// ─── Tools ───────────────────────────────────────────────────────────

export const getActiveApprovalsTool = createTool({
  name: "getActiveApprovals",
  description:
    "Scan all ERC-20 token approvals for an address on a specific chain. Returns every (token, spender) pair that currently has a non-zero allowance, with the approved amount and token metadata. Similar to revoke.cash.",
  supportedChains: approvalChains,
  parameters: z.object({
    owner: z
      .string()
      .describe("The wallet address to scan approvals for"),
    chainId: z
      .number()
      .describe("Chain ID to scan (1, 137, 42161, 10, 8453)"),
  }),
  execute: async (client: AgentekClient, args) => {
    const { owner, chainId } = args;

    // 1. Fetch all Approval logs for the owner from Blockscout
    const logs = await fetchApprovalLogs(chainId, owner);
    if (logs.length === 0) {
      return { chainId, owner, approvals: [], total: 0, scannedPairs: 0 };
    }

    // 2. Deduplicate to unique (token, spender) pairs
    const pairs = deduplicateApprovals(logs);

    // 3. Check current on-chain allowance for each pair via multicall
    //    This batches all reads into fewer RPC requests.
    const publicClient = client.getPublicClient(chainId);

    const multicallContracts = pairs.flatMap((pair) => [
      {
        address: pair.token as Address,
        abi: erc20Abi,
        functionName: "allowance" as const,
        args: [owner as Address, pair.spender as Address],
      },
      {
        address: pair.token as Address,
        abi: erc20Abi,
        functionName: "decimals" as const,
      },
      {
        address: pair.token as Address,
        abi: erc20Abi,
        functionName: "symbol" as const,
      },
      {
        address: pair.token as Address,
        abi: erc20Abi,
        functionName: "name" as const,
      },
    ]);

    const multicallResults = await publicClient.multicall({
      contracts: multicallContracts,
      allowFailure: true,
    });

    // Each pair has 4 results: allowance, decimals, symbol, name
    const results = pairs.map((pair, i) => {
      const base = i * 4;
      const allowanceResult = multicallResults[base];
      const decimalsResult = multicallResults[base + 1];
      const symbolResult = multicallResults[base + 2];
      const nameResult = multicallResults[base + 3];

      const allowance =
        allowanceResult.status === "success"
          ? (allowanceResult.result as bigint)
          : 0n;
      const decimals =
        decimalsResult.status === "success"
          ? (decimalsResult.result as number)
          : 18;
      const symbol =
        symbolResult.status === "success"
          ? (symbolResult.result as string)
          : "UNKNOWN";
      const name =
        nameResult.status === "success"
          ? (nameResult.result as string)
          : "Unknown Token";

      return {
        token: pair.token,
        tokenName: name,
        tokenSymbol: symbol,
        decimals,
        spender: pair.spender,
        allowance: allowance.toString(),
        allowanceFormatted: formatUnits(allowance, decimals),
        isUnlimited: allowance >= maxUint256 / 2n,
      };
    });

    // Filter to only active (non-zero) approvals
    const active = results.filter((r) => BigInt(r.allowance) > 0n);

    // Sort: unlimited first (highest risk), then by allowance descending
    active.sort((a: any, b: any) => {
      if (a.isUnlimited && !b.isUnlimited) return -1;
      if (!a.isUnlimited && b.isUnlimited) return 1;
      return BigInt(b.allowance) > BigInt(a.allowance) ? 1 : -1;
    });

    return {
      chainId,
      owner,
      approvals: active,
      total: active.length,
      scannedPairs: pairs.length,
    };
  },
});

export const intentRevokeApprovalTool = createTool({
  name: "intentRevokeApproval",
  description:
    "Revoke (set to zero) an ERC-20 token approval for a specific spender. This is equivalent to calling approve(spender, 0).",
  supportedChains: approvalChains,
  parameters: z.object({
    token: z.string().describe("The token contract address"),
    spender: z.string().describe("The spender address to revoke approval for"),
    chainId: z.number().describe("Chain ID to execute on"),
  }),
  execute: async (client: AgentekClient, args): Promise<Intent> => {
    const { token, spender, chainId } = args;

    const ops = [
      {
        target: token as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, 0n],
        }),
      },
    ];

    const walletClient = client.getWalletClient(chainId);

    if (!walletClient) {
      return {
        intent: `revoke approval for ${spender} on token ${token}`,
        ops,
        chain: chainId,
      };
    }

    const hash = await client.executeOps(ops, chainId);
    return {
      intent: `revoke approval for ${spender} on token ${token}`,
      ops,
      chain: chainId,
      hash,
    };
  },
});

export const intentRevokeAllApprovalsTool = createTool({
  name: "intentRevokeAllApprovals",
  description:
    "Revoke ALL active ERC-20 token approvals for the connected wallet on a specific chain. Scans for approvals first, then creates revoke transactions for each one. Use with caution — this will revoke approvals needed by DeFi protocols you actively use.",
  supportedChains: approvalChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID to scan and revoke on"),
  }),
  execute: async (client: AgentekClient, args): Promise<Intent> => {
    const { chainId } = args;
    const owner = await client.getAddress();

    const logs = await fetchApprovalLogs(chainId, owner);
    const pairs = deduplicateApprovals(logs);

    const publicClient = client.getPublicClient(chainId);

    // Use multicall to batch all allowance checks
    const allowanceResults = await publicClient.multicall({
      contracts: pairs.map((pair) => ({
        address: pair.token as Address,
        abi: erc20Abi,
        functionName: "allowance" as const,
        args: [owner as Address, pair.spender as Address],
      })),
      allowFailure: true,
    });

    const activePairs = pairs.filter((_, i) => {
      const r = allowanceResults[i];
      return r.status === "success" && (r.result as bigint) > 0n;
    });

    if (activePairs.length === 0) {
      return {
        intent: `no active approvals found on chain ${chainId}`,
        ops: [],
        chain: chainId,
      };
    }

    const ops = activePairs.map((pair) => ({
      target: pair.token as Address,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [pair.spender as Address, 0n],
      }),
    }));

    const walletClient = client.getWalletClient(chainId);

    if (!walletClient) {
      return {
        intent: `revoke ${activePairs.length} approvals on chain ${chainId}`,
        ops,
        chain: chainId,
      };
    }

    const hash = await client.executeOps(ops, chainId);
    return {
      intent: `revoked ${activePairs.length} approvals on chain ${chainId}`,
      ops,
      chain: chainId,
      hash,
    };
  },
});
