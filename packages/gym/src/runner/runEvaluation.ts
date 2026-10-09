import { createHash, randomUUID } from "node:crypto";
import type { Address } from "viem";
import { AnvilForkEnvironment } from "../environment/AnvilForkEnvironment.js";
import { GYM_CHAIN_IDS } from "../environment/AnvilForkEnvironment.js";
import { MultiChainForkEnvironment } from "../environment/MultiChainForkEnvironment.js";
import { AcrossRelayerAdapter, type AcrossRelayTrace } from "../adapters/AcrossRelayerAdapter.js";
import { gradeTask, type GradeResult } from "../graders/grade.js";
import { aggregateCost, evaluateSafety, type CostResult, type ModelCallTrace, type SafetyResult } from "./dimensions.js";
import {
  createGymAgentekClient,
  selectMvpAgentekTools,
} from "../harness/AgentekClientFactory.js";
import {
  GymLimitError,
  ToolHarness,
  type Termination,
  type ToolDescription,
} from "../harness/ToolHarness.js";
import { loadTask, parseTask } from "../task/loadTask.js";
import type { MvpTask } from "../task/schema.js";
import type { GymChainName } from "../environment/types.js";

export interface AgentContext {
  objective: string;
  walletAddress: Address;
  tools: readonly ToolDescription[];
  /** Task-specific model-turn cap; the adapter also enforces its run cap. */
  maxModelRequests?: number;
  execute(tool: string, arguments_: unknown): Promise<unknown>;
  recordModelRequest?(): void;
  recordModelResponse?(response: ModelCallTrace): void;
  signal: AbortSignal;
}

export interface AgentRunResult {
  completed: boolean;
  output?: string;
  modelRequests?: number;
}

export interface AgentAdapter {
  run(context: AgentContext): Promise<AgentRunResult>;
}

export interface EvaluationOptions {
  upstreamRpcUrl: string;
  upstreamRpcUrls?: Partial<Record<GymChainName, string>>;
  model: string;
  anvilBinary?: string;
  zeroxApiKey?: string;
  hardfork?: "shanghai" | "cancun" | "prague";
}

export interface EvaluationResult {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  taskFingerprint: string;
  model: string;
  success: boolean;
  correctness: { passed: boolean; score: number };
  safety: SafetyResult;
  cost: CostResult;
  modelCalls: ModelCallTrace[];
  metrics: {
    steps: number;
    toolCalls: number;
    transactions: number;
    reverts: number;
    gasUsed: string;
    durationMs: number;
    modelRequests?: number;
  };
  graders: GradeResult[];
  safetyGraders: GradeResult[];
  termination?: Termination;
  environment: { chain: "ethereum"; forkBlock: number } | { chains: { chain: GymChainName; forkBlock: number }[]; across: "anvil_state_override" };
  agentOutput?: string;
  error?: string;
}

export interface EvaluationTrace {
  taskId: string;
  runId: string;
  initialState?: {
    walletAddress: Address;
    walletNativeBalance: string;
    blockNumber: string;
  };
  finalState?: {
    walletAddress: Address;
    walletNativeBalance: string;
    blockNumber: string;
  };
  initialStates?: Record<string, ReturnType<typeof serializableState>>;
  finalStates?: Record<string, ReturnType<typeof serializableState>>;
  calls: ReturnType<ToolHarness["getTrace"]>["calls"];
  transactions: ReturnType<ToolHarness["getTrace"]>["transactions"];
  acrossRelays: AcrossRelayTrace[];
  modelCalls: ModelCallTrace[];
}

export interface EvaluationRun {
  result: EvaluationResult;
  trace: EvaluationTrace;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintTask(task: MvpTask): string {
  return createHash("sha256").update(canonical(task)).digest("hex");
}

function serializableState(state: Awaited<ReturnType<AnvilForkEnvironment["inspect"]>>) {
  return {
    walletAddress: state.walletAddress,
    walletNativeBalance: state.walletNativeBalance.toString(),
    blockNumber: state.blockNumber.toString(),
  };
}

/** Execute one validated task against a fresh, disposable Anvil fork. */
export async function runEvaluation(
  taskInput: MvpTask | string | URL,
  agent: AgentAdapter,
  options: EvaluationOptions,
): Promise<EvaluationRun> {
  const task = typeof taskInput === "string" || taskInput instanceof URL
    ? await loadTask(taskInput)
    : parseTask(taskInput);
  // Fail task/configuration validation before launching Anvil.
  selectMvpAgentekTools(task.tools, { zeroxApiKey: options.zeroxApiKey });
  const multiEnvironment = "chains" in task.environment ? task.environment : undefined;
  const singleEnvironment = "chain" in task.environment ? task.environment : undefined;
  if (multiEnvironment) {
    for (const fork of multiEnvironment.chains) {
      if (!options.upstreamRpcUrls?.[fork.chain] &&
          !(fork.chain === "ethereum" && options.upstreamRpcUrl)) {
        throw new Error(`Missing upstream RPC for ${fork.chain}`);
      }
    }
  }
  const runId = randomUUID();
  const harness = new ToolHarness(task.limits);
  const environment = multiEnvironment
    ? new MultiChainForkEnvironment({ chains: multiEnvironment.chains.map((fork) => ({
        chain: fork.chain,
        blockNumber: BigInt(fork.blockNumber),
        upstreamRpcUrl: options.upstreamRpcUrls?.[fork.chain] ?? options.upstreamRpcUrl,
        anvilBinary: options.anvilBinary,
        hardfork: fork.hardfork ?? options.hardfork,
      })) })
    : new AnvilForkEnvironment({
        chain: singleEnvironment!.chain,
        blockNumber: BigInt(singleEnvironment!.blockNumber),
        upstreamRpcUrl: options.upstreamRpcUrl,
        anvilBinary: options.anvilBinary,
        hardfork: singleEnvironment!.hardfork ?? options.hardfork,
      });
  let across: AcrossRelayerAdapter | undefined;
  const controller = new AbortController();
  let initialState: EvaluationTrace["initialState"];
  let finalState: EvaluationTrace["finalState"];
  let initialStates: EvaluationTrace["initialStates"];
  let finalStates: EvaluationTrace["finalStates"];
  let graders: GradeResult[] = [];
  let safetyGraders: GradeResult[] = [];
  let agentResult: AgentRunResult | undefined;
  let modelRequests = 0;
  const modelCalls: ModelCallTrace[] = [];
  let runError: string | undefined;
  let started = false;

  try {
    await environment.start();
    started = true;
    if (environment instanceof MultiChainForkEnvironment) {
      for (const fork of multiEnvironment!.chains) {
        const wallet = task.wallet.chains?.[fork.chain];
        if (!wallet) throw new Error(`Missing wallet configuration for ${fork.chain}`);
        await environment.provisionWallet(GYM_CHAIN_IDS[fork.chain], {
          balances: wallet.balances ?? {},
          assets: wallet.assets as import("../environment/types.js").WalletProvisioningConfig["assets"],
        });
      }
      initialStates = Object.fromEntries(Object.entries(await environment.inspect())
        .map(([chainId, state]) => [chainId, serializableState(state)]));
      across = new AcrossRelayerAdapter({
        environment,
        chains: multiEnvironment!.across.chains.map((entry) => ({
          chainId: GYM_CHAIN_IDS[entry.chain],
          spokePool: entry.spokePool,
          assets: entry.assets,
        })),
        pollIntervalMs: 100,
      });
      await across.start();
    } else {
      await environment.provisionWallet({ balances: task.wallet.balances ?? {} });
      initialState = serializableState(await environment.inspect());
    }
    const client = await createGymAgentekClient({
      environment,
      tools: task.tools,
      zeroxApiKey: options.zeroxApiKey,
      rpcObserver: harness,
    });
    harness.bind(client);
    harness.start();

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          harness.markTimeout();
          reject(new GymLimitError(harness.getTermination()!));
        }, task.limits.timeoutMs);
      });
      agentResult = await Promise.race([
        agent.run({
          objective: task.objective,
          walletAddress: environment.getWalletAccount().address,
          tools: harness.tools,
          maxModelRequests: task.limits.maxModelRequests,
          execute: (tool, args) => harness.execute(tool, args),
          recordModelRequest: () => { modelRequests += 1; },
          recordModelResponse: (response) => { modelCalls.push(response); },
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      if (!(error instanceof GymLimitError)) harness.markAgentError(error);
      runError = error instanceof Error ? error.message : String(error);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }

    if (environment instanceof MultiChainForkEnvironment) {
      await across?.flush();
      finalStates = Object.fromEntries(Object.entries(await environment.inspect())
        .map(([chainId, state]) => [chainId, serializableState(state)]));
    } else {
      finalState = serializableState(await environment.inspect());
    }
    graders = await gradeTask(task.graders, environment, task, across?.getTraces() ?? [], agentResult?.output);
    safetyGraders = await gradeTask(task.safety?.balanceFloors ?? [], environment, task);
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    if (!started) {
      harness.markAgentError(error);
    } else if (!harness.getTermination()) {
      harness.markAgentError(error);
    }
  } finally {
    controller.abort();
    try {
      await across?.stop();
    } finally {
      await environment.stop();
    }
  }

  const correctnessPassed = graders.length === task.graders.length &&
    graders.every((grader) => grader.passed);
  const termination = harness.getTermination();
  const trace = harness.getTrace();
  const metrics = harness.getMetrics();
  const safety = evaluateSafety(task, trace.transactions, safetyGraders);
  const cost = aggregateCost(Math.max(modelRequests, agentResult?.modelRequests ?? 0), modelCalls, trace.transactions);
  return {
    result: {
      schemaVersion: 1,
      runId,
      taskId: task.id,
      taskFingerprint: fingerprintTask(task),
      model: options.model,
      success: correctnessPassed && safety.passed && !termination,
      correctness: { passed: correctnessPassed, score: correctnessPassed ? 1 : 0 },
      safety,
      cost,
      modelCalls,
      metrics: { ...metrics, modelRequests: Math.max(modelRequests, agentResult?.modelRequests ?? 0) },
      graders,
      safetyGraders,
      termination,
      environment: multiEnvironment
        ? { chains: multiEnvironment.chains.map((fork) => ({ chain: fork.chain, forkBlock: fork.blockNumber })), across: "anvil_state_override" }
        : { chain: singleEnvironment!.chain, forkBlock: singleEnvironment!.blockNumber },
      agentOutput: agentResult?.output,
      error: runError,
    },
    trace: { taskId: task.id, runId, initialState, finalState, initialStates, finalStates,
      ...trace, acrossRelays: across?.getTraces() ?? [], modelCalls },
  };
}
