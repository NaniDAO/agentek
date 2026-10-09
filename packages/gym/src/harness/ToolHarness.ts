import type { AgentekClient } from "@agentek/tools/client";
import type { Address, Hex } from "viem";
import type { GymRpcObserver } from "./AgentekClientFactory.js";
import type { MvpTask } from "../task/schema.js";

export type TerminationReason =
  | "MAX_STEPS"
  | "MAX_TRANSACTIONS"
  | "MAX_REVERTS"
  | "TIMEOUT"
  | "AGENT_ERROR";

export interface Termination {
  reason: TerminationReason;
  limit?: number;
  actual?: number;
  message?: string;
}

export interface TransactionTrace {
  hash: Hex;
  chainId: number;
  status?: "success" | "reverted";
  gasUsed?: string;
  feeWei?: string;
  from?: Address;
  to?: Address | null;
  logsCount?: number;
}

export interface ToolCallTrace {
  sequence: number;
  timestamp: number;
  tool: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  durationMs: number;
  transactionHashes: Hex[];
  chainId?: number;
}

export interface ToolDescription {
  name: string;
  description: string;
  parameters: unknown;
}

export class GymLimitError extends Error {
  constructor(public readonly termination: Termination) {
    super(`Gym limit reached: ${termination.reason}`);
    this.name = "GymLimitError";
  }
}

export class ToolHarness implements GymRpcObserver {
  private client?: AgentekClient;
  private readonly calls: ToolCallTrace[] = [];
  private readonly transactions: TransactionTrace[] = [];
  private readonly receiptHashes = new Set<string>();
  private startedAt = Date.now();
  private deadline = Infinity;
  private termination?: Termination;
  private attemptedSteps = 0;
  private attemptedTransactions = 0;
  private reverts = 0;

  constructor(private readonly limits: MvpTask["limits"]) {}

  bind(client: AgentekClient): void {
    if (this.client) throw new Error("Tool harness is already bound");
    this.client = client;
  }

  start(): void {
    this.startedAt = Date.now();
    this.deadline = this.startedAt + this.limits.timeoutMs;
  }

  get tools(): ToolDescription[] {
    if (!this.client) throw new Error("Tool harness is not bound");
    return [...this.client.getTools().values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  getTrace(): { calls: ToolCallTrace[]; transactions: TransactionTrace[] } {
    return {
      calls: [...this.calls],
      transactions: this.transactions.map((tx) => ({ ...tx })),
    };
  }

  getTermination(): Termination | undefined {
    return this.termination;
  }

  getMetrics() {
    return {
      steps: this.calls.length,
      toolCalls: this.calls.length,
      transactions: this.transactions.length,
      reverts: this.reverts,
      gasUsed: this.transactions
        .reduce((total, tx) => total + BigInt(tx.gasUsed ?? "0"), 0n)
        .toString(),
      durationMs: Date.now() - this.startedAt,
    };
  }

  private setLimit(termination: Termination): never {
    this.termination ??= termination;
    throw new GymLimitError(this.termination);
  }

  private assertActive(): void {
    if (this.termination) throw new GymLimitError(this.termination);
    if (Date.now() >= this.deadline) {
      this.setLimit({
        reason: "TIMEOUT",
        limit: this.limits.timeoutMs,
        actual: Date.now() - this.startedAt,
      });
    }
  }

  async execute(tool: string, args: unknown): Promise<unknown> {
    this.assertActive();
    const client = this.client;
    if (!client || !client.getTools().has(tool)) {
      throw new Error(`Tool ${tool} is not available to this agent`);
    }
    this.attemptedSteps += 1;
    if (this.attemptedSteps > this.limits.maxSteps) {
      this.setLimit({
        reason: "MAX_STEPS",
        limit: this.limits.maxSteps,
        actual: this.attemptedSteps,
      });
    }

    const trace: ToolCallTrace = {
      sequence: this.calls.length + 1,
      timestamp: Date.now(),
      tool,
      arguments: args,
      durationMs: 0,
      transactionHashes: [],
      chainId: typeof args === "object" && args !== null && "chainId" in args
        ? Number(args.chainId)
        : undefined,
    };
    this.calls.push(trace);
    const firstTransaction = this.transactions.length;
    const startedAt = Date.now();
    try {
      trace.result = await client.execute(tool, args);
      this.assertActive();
      return trace.result;
    } catch (error) {
      trace.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      trace.durationMs = Date.now() - startedAt;
      trace.transactionHashes = this.transactions
        .slice(firstTransaction)
        .map((transaction) => transaction.hash);
    }
  }

  async beforeRequest(method: string, _params?: unknown[], _chainId?: number): Promise<void> {
    if (method !== "eth_sendRawTransaction" && method !== "eth_sendTransaction") return;
    this.assertActive();
    this.attemptedTransactions += 1;
    if (this.attemptedTransactions > this.limits.maxTransactions) {
      this.setLimit({
        reason: "MAX_TRANSACTIONS",
        limit: this.limits.maxTransactions,
        actual: this.attemptedTransactions,
      });
    }
  }

  async afterResponse(method: string, result: unknown, chainId = 1): Promise<void> {
    if (method === "eth_sendRawTransaction" || method === "eth_sendTransaction") {
      if (typeof result === "string" && /^0x[0-9a-fA-F]{64}$/.test(result)) {
        this.transactions.push({ hash: result as Hex, chainId });
      }
      return;
    }
    if (method !== "eth_getTransactionReceipt" || !result || typeof result !== "object") {
      return;
    }
    const receipt = result as Record<string, unknown>;
    const hash = typeof receipt.transactionHash === "string"
      ? receipt.transactionHash.toLowerCase()
      : "";
    const transaction = this.transactions.find((tx) =>
      tx.chainId === chainId && tx.hash.toLowerCase() === hash);
    if (!transaction || this.receiptHashes.has(hash)) return;
    this.receiptHashes.add(hash);
    transaction.status = receipt.status === "0x1" ? "success" : "reverted";
    transaction.gasUsed = BigInt(String(receipt.gasUsed ?? "0x0")).toString();
    if (receipt.effectiveGasPrice !== undefined) {
      transaction.feeWei = (
        BigInt(transaction.gasUsed) * BigInt(String(receipt.effectiveGasPrice))
      ).toString();
    }
    transaction.from = receipt.from as Address | undefined;
    transaction.to = receipt.to as Address | null | undefined;
    transaction.logsCount = Array.isArray(receipt.logs) ? receipt.logs.length : 0;
    if (transaction.status === "reverted") {
      this.reverts += 1;
      if (this.reverts > this.limits.maxReverts) {
        this.termination ??= {
          reason: "MAX_REVERTS",
          limit: this.limits.maxReverts,
          actual: this.reverts,
        };
      }
    }
  }

  markTimeout(): void {
    this.termination ??= {
      reason: "TIMEOUT",
      limit: this.limits.timeoutMs,
      actual: Date.now() - this.startedAt,
    };
  }

  markAgentError(error: unknown): void {
    if (this.termination) return;
    this.termination = {
      reason: "AGENT_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
