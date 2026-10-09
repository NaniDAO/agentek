import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { formatUnits, parseUnits } from "viem";
import { loadTask } from "../task/loadTask.js";
import { selectMvpAgentekTools } from "../harness/AgentekClientFactory.js";
import {
  fingerprintTask,
  runEvaluation,
  type AgentAdapter,
  type EvaluationOptions,
  type EvaluationResult,
  type EvaluationTrace,
} from "../runner/runEvaluation.js";

const manifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  name: z.string().min(1).max(256).optional(),
  expectedTasks: z.number().int().positive().optional(),
  requireUniqueCategories: z.boolean().optional(),
  tasks: z.array(z.string().min(1)).min(1).max(10_000),
}).strict();

export interface SuiteTaskSummary {
  taskId: string;
  category?: string;
  taskFingerprint: string;
  success: boolean;
  correctnessScore: number;
  steps: number;
  toolCalls: number;
  toolUsage: Record<string, number>;
  transactions: number;
  reverts: number;
  gasUsed: string;
  durationMs: number;
  modelRequests?: number;
  graders: EvaluationResult["graders"];
  safety: EvaluationResult["safety"];
  cost: EvaluationResult["cost"];
  servingProviders: string[];
  resolvedModels: string[];
  termination?: string;
  resultPath: string;
  tracePath: string;
}

export interface SuiteReport {
  schemaVersion: 1;
  suiteId: string;
  suiteFingerprint: string;
  runId: string;
  model: string;
  provider: string;
  modelVersion?: string;
  inferenceSettings: Record<string, unknown>;
  runConfigurationFingerprint: string;
  servingProviders: string[];
  resolvedModels: string[];
  createdAt: string;
  total: number;
  completed: number;
  complete: boolean;
  passed: number;
  safetyPassed: number;
  passRate: number;
  totals: {
    toolCalls: number;
    toolUsage: Record<string, number>;
    transactions: number;
    reverts: number;
    gasUsed: string;
    durationMs: number;
    modelRequests: number;
    promptTokens: number;
    completionTokens: number;
    modelCostUsd: string | null;
    modelCostComplete: boolean;
    gasFeeWeiByChain: Record<string, string>;
  };
  tasks: SuiteTaskSummary[];
}

export interface RunSuiteOptions extends EvaluationOptions {
  manifestPath: string;
  outputDir: string;
  agent: AgentAdapter;
  secrets?: readonly string[];
  resume?: boolean;
  /** Stop after this many completed suite tasks; omitted when resuming to finish. */
  stopAfter?: number;
  provider?: string;
  modelVersion?: string;
  inferenceSettings?: Record<string, unknown>;
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

export function fingerprintRunConfiguration(options: Pick<RunSuiteOptions,
  "model" | "provider" | "modelVersion" | "inferenceSettings">): string {
  return createHash("sha256").update(canonical({
    model: options.model,
    provider: options.provider ?? "custom",
    modelVersion: options.modelVersion ?? null,
    inferenceSettings: options.inferenceSettings ?? {},
  })).digest("hex");
}

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return secrets.reduce(
      (text, secret) => secret ? text.split(secret).join("[redacted]") : text,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /private.?key|api.?key|authorization|password|secret|upstreamRpcUrl/i.test(key)
          ? "[redacted]"
          : redact(child, secrets),
      ]),
    );
  }
  return value;
}

async function writeJson(path: string, value: unknown, secrets: readonly string[]): Promise<void> {
  await writeFile(path, `${JSON.stringify(redact(value, secrets), null, 2)}\n`, "utf8");
}

function escapeCell(value: string): string {
  return value.split("|").join("\\|").split("\n").join(" ");
}

export function renderSuiteMarkdown(report: SuiteReport): string {
  const lines = [
    `# ${report.suiteId} — ${report.model}`,
    "",
    `Run: \`${report.runId}\`  `,
    `Suite fingerprint: \`${report.suiteFingerprint}\`  `,
    `Run settings: \`${report.runConfigurationFingerprint}\`  `,
    `Provider: ${report.provider}; declared version: ${report.modelVersion ?? "unreported"}  `,
    `Serving providers: ${report.servingProviders.join(", ") || "unknown"}  `,
    `Completed: **${report.completed}/${report.total}**  `,
    `Passed: **${report.passed}/${report.completed}** (${(report.passRate * 100).toFixed(1)}%)`,
    `Safety passed: **${report.safetyPassed}/${report.completed}**  `,
    `Known model cost: **${report.totals.modelCostUsd ?? "unknown"} USD**${report.totals.modelCostComplete ? "" : " (incomplete)"}`,
    "",
    "| Task | Category | Result | Graders | Safety | Model USD | Served by | Score | Model requests | Tool calls | Tool breakdown | Transactions | Reverts | Gas | Duration ms | Termination | Artifacts |",
    "| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const task of report.tasks) {
    const graderBreakdown = task.graders.map((grader) =>
      `${grader.type} ${grader.asset} ${grader.operator} ${grader.expected}: ` +
      `${grader.passed ? "PASS" : "FAIL"}` +
      (grader.actual !== undefined ? ` (raw ${grader.actual}, d${grader.decimals})` : ""),
    ).join("; ");
    lines.push(
      `| ${escapeCell(task.taskId)} | ${escapeCell(task.category ?? "—")} | ${task.success ? "PASS" : "FAIL"} | ` +
      `${escapeCell(graderBreakdown)} | ${task.safety.evaluated ? task.safety.passed ? "PASS" : "FAIL" : "—"} | ` +
      `${task.cost.modelCostUsd ?? "unknown"}${task.cost.modelCostComplete ? "" : "*"} | ` +
      `${escapeCell(task.servingProviders.join(", ") || "unknown")} | ${task.correctnessScore} | ` +
      `${task.modelRequests ?? "—"} | ${task.toolCalls} | ` +
      `${escapeCell(Object.entries(task.toolUsage ?? {}).map(([tool, count]) => `${tool} ×${count}`).join(", ") || "—")} | ` +
      `${task.transactions} | ${task.reverts} | ${task.gasUsed} | ` +
      `${task.durationMs} | ${task.termination ?? ""} | ` +
      `[result](${task.resultPath}), [trace](${task.tracePath}) |`,
    );
  }
  lines.push("", "*Model cost is incomplete where provider billing metadata was unavailable. The pass rate does not define benchmark ranking policy.", "");
  return lines.join("\n");
}

export async function runSuite(options: RunSuiteOptions): Promise<SuiteReport> {
  const manifestPath = resolve(options.manifestPath);
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const manifest = manifestSchema.parse(raw);
  if (manifest.expectedTasks !== undefined && manifest.tasks.length !== manifest.expectedTasks) {
    throw new Error(
      `Suite expected ${manifest.expectedTasks} tasks but listed ${manifest.tasks.length}`,
    );
  }
  if (options.stopAfter !== undefined &&
      (!Number.isSafeInteger(options.stopAfter) || options.stopAfter < 1 ||
       options.stopAfter > manifest.tasks.length)) {
    throw new Error("stopAfter must be an integer between 1 and the suite task count");
  }

  // Every task is loaded and validated before the first fork is launched.
  const taskEntries = await Promise.all(manifest.tasks.map(async (path) => {
    const absolute = isAbsolute(path) ? path : resolve(dirname(manifestPath), path);
    const task = await loadTask(absolute);
    return { task, path: absolute };
  }));
  const ids = new Set<string>();
  const categories = new Set<string>();
  for (const { task } of taskEntries) {
    if (ids.has(task.id)) throw new Error(`Duplicate suite task ID ${task.id}`);
    ids.add(task.id);
    if (manifest.requireUniqueCategories) {
      if (!task.category) throw new Error(`Suite task ${task.id} is missing a category`);
      if (categories.has(task.category)) throw new Error(`Duplicate suite task category ${task.category}`);
      categories.add(task.category);
    }
    selectMvpAgentekTools(task.tools, { zeroxApiKey: options.zeroxApiKey });
    if ("chains" in task.environment) {
      for (const fork of task.environment.chains) {
        if (!options.upstreamRpcUrls?.[fork.chain] &&
            !(fork.chain === "ethereum" && options.upstreamRpcUrl)) {
          throw new Error(`Missing upstream RPC for ${fork.chain}`);
        }
      }
    }
  }

  const suiteFingerprint = createHash("sha256")
    .update(JSON.stringify(taskEntries.map(({ task }) => [task.id, fingerprintTask(task)])))
    .digest("hex");
  const runConfigurationFingerprint = fingerprintRunConfiguration(options);
  const secrets = [
    options.upstreamRpcUrl,
    ...Object.values(options.upstreamRpcUrls ?? {}),
    options.zeroxApiKey ?? "",
    ...(options.secrets ?? []),
  ];
  const outputDir = resolve(options.outputDir);
  let existing = false;
  try {
    await stat(outputDir);
    existing = true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (existing && !options.resume) {
    throw new Error(`Output directory already exists: ${outputDir}; use resume to reuse completed tasks`);
  }
  if (!existing && options.resume) {
    throw new Error(`Cannot resume missing output directory: ${outputDir}`);
  }
  if (!existing) {
    await mkdir(dirname(outputDir), { recursive: true });
    try {
      await mkdir(outputDir);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error(`Output directory was claimed by another run: ${outputDir}`);
      }
      throw error;
    }
  }
  const lockPath = join(outputDir, ".run.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Another evaluation is already using ${outputDir}`);
    }
    throw error;
  }
  try {
  const metadataPath = join(outputDir, "run.json");
  let createdAt: string;
  let runId: string;
  if (options.resume) {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      suiteFingerprint: string;
      runConfigurationFingerprint: string;
      model: string;
      runId: string;
      createdAt: string;
    };
    if (metadata.suiteFingerprint !== suiteFingerprint ||
        metadata.runConfigurationFingerprint !== runConfigurationFingerprint ||
        metadata.model !== options.model) {
      throw new Error("Cannot resume with a different suite definition, model, or inference settings");
    }
    ({ createdAt, runId } = metadata);
  } else {
    createdAt = new Date().toISOString();
    runId = randomUUID();
    await writeJson(metadataPath, {
      schemaVersion: 1,
      suiteId: manifest.id,
      suiteFingerprint,
      runConfigurationFingerprint,
      model: options.model,
      provider: options.provider ?? "custom",
      modelVersion: options.modelVersion,
      inferenceSettings: options.inferenceSettings ?? {},
      runId,
      createdAt,
    }, secrets);
  }
  const summaries: SuiteTaskSummary[] = [];

  const makeReport = (): SuiteReport => {
    const passed = summaries.filter((task) => task.success).length;
    const knownCosts = summaries.flatMap((task) => task.cost.modelCostUsd === null
      ? [] : [parseUnits(task.cost.modelCostUsd, 12)]);
    const gasFeeWeiByChain: Record<string, string> = {};
    const toolUsage: Record<string, number> = {};
    for (const task of summaries) {
      for (const [tool, count] of Object.entries(task.toolUsage)) {
        toolUsage[tool] = (toolUsage[tool] ?? 0) + count;
      }
      for (const [chain, fee] of Object.entries(task.cost.gasFeeWeiByChain)) {
        gasFeeWeiByChain[chain] = (BigInt(gasFeeWeiByChain[chain] ?? "0") + BigInt(fee)).toString();
      }
    }
    return {
      schemaVersion: 1,
      suiteId: manifest.id,
      suiteFingerprint,
      runId,
      model: options.model,
      provider: options.provider ?? "custom",
      modelVersion: options.modelVersion,
      inferenceSettings: options.inferenceSettings ?? {},
      runConfigurationFingerprint,
      servingProviders: [...new Set(summaries.flatMap((task) => task.servingProviders))].sort(),
      resolvedModels: [...new Set(summaries.flatMap((task) => task.resolvedModels))].sort(),
      createdAt,
      total: taskEntries.length,
      completed: summaries.length,
      complete: summaries.length === taskEntries.length,
      passed,
      safetyPassed: summaries.filter((task) => task.safety.passed).length,
      passRate: summaries.length ? passed / summaries.length : 0,
      totals: {
        toolCalls: summaries.reduce((sum, task) => sum + task.toolCalls, 0),
        toolUsage,
        transactions: summaries.reduce((sum, task) => sum + task.transactions, 0),
        reverts: summaries.reduce((sum, task) => sum + task.reverts, 0),
        gasUsed: summaries.reduce((sum, task) => sum + BigInt(task.gasUsed), 0n).toString(),
        durationMs: summaries.reduce((sum, task) => sum + task.durationMs, 0),
        modelRequests: summaries.reduce((sum, task) => sum + (task.modelRequests ?? 0), 0),
        promptTokens: summaries.reduce((sum, task) => sum + task.cost.promptTokens, 0),
        completionTokens: summaries.reduce((sum, task) => sum + task.cost.completionTokens, 0),
        modelCostUsd: knownCosts.length ? formatUnits(knownCosts.reduce((sum, cost) => sum + cost, 0n), 12) : null,
        modelCostComplete: summaries.every((task) => task.cost.modelCostComplete),
        gasFeeWeiByChain,
      },
      tasks: [...summaries],
    };
  };

  const saveProgress = async (): Promise<void> => {
    const report = makeReport();
    await Promise.all([
      writeJson(join(outputDir, "report.json"), report, secrets),
      writeFile(join(outputDir, "report.md"), String(redact(renderSuiteMarkdown(report), secrets)), "utf8"),
    ]);
  };
  if (!options.resume) await saveProgress();

  for (const { task } of taskEntries) {
    if (options.stopAfter !== undefined && summaries.length >= options.stopAfter) break;
    const taskDir = join(outputDir, "tasks", task.id);
    const resultPath = `tasks/${task.id}/result.json`;
    const tracePath = `tasks/${task.id}/trace.json`;
    if (options.resume) {
      try {
        const [savedResult, savedTrace] = await Promise.all([
          readFile(join(outputDir, resultPath), "utf8"),
          readFile(join(outputDir, tracePath), "utf8"),
        ]);
        const result = JSON.parse(savedResult) as EvaluationResult;
        const trace = JSON.parse(savedTrace) as EvaluationTrace;
        if (result.taskId === task.id &&
            result.taskFingerprint === fingerprintTask(task) &&
            result.model === options.model &&
            trace.taskId === task.id && trace.runId === result.runId) {
          summaries.push(summarizeTask(result, resultPath, tracePath, trace.calls, task.category));
          await saveProgress();
          continue;
        }
        throw new Error(`Cannot resume: saved artifact for ${task.id} does not match the task`);
      } catch (error) {
        if (!(error instanceof Error) ||
            (!(error instanceof SyntaxError) && !("code" in error && error.code === "ENOENT"))) {
          throw error;
        }
      }
    }
    await mkdir(taskDir, { recursive: true });
    const { result, trace } = await runEvaluation(task, options.agent, options);
    await Promise.all([
      writeJson(join(outputDir, resultPath), result, secrets),
      writeJson(join(outputDir, tracePath), trace, secrets),
    ]);
    summaries.push(summarizeTask(result, resultPath, tracePath, trace.calls, task.category));
    await saveProgress();
  }

  return makeReport();
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function summarizeTask(
  result: EvaluationResult,
  resultPath: string,
  tracePath: string,
  calls: EvaluationTrace["calls"],
  category?: string,
): SuiteTaskSummary {
  const toolUsage: Record<string, number> = {};
  for (const call of calls) toolUsage[call.tool] = (toolUsage[call.tool] ?? 0) + 1;
  return {
    taskId: result.taskId,
    category,
    taskFingerprint: result.taskFingerprint,
    success: result.success,
    correctnessScore: result.correctness.score,
    steps: result.metrics.steps,
    toolCalls: result.metrics.toolCalls,
    toolUsage,
    transactions: result.metrics.transactions,
    reverts: result.metrics.reverts,
    gasUsed: result.metrics.gasUsed,
    durationMs: result.metrics.durationMs,
    modelRequests: result.metrics.modelRequests,
    graders: result.graders,
    safety: result.safety,
    cost: result.cost,
    servingProviders: [...new Set(result.modelCalls.map((call) => call.servingProvider).filter((value): value is string => Boolean(value)))].sort(),
    resolvedModels: [...new Set(result.modelCalls.map((call) => call.resolvedModel).filter((value): value is string => Boolean(value)))].sort(),
    termination: result.termination?.reason,
    resultPath,
    tracePath,
  };
}

export interface ComparisonReport {
  schemaVersion: 1;
  suiteId: string;
  suiteFingerprint: string;
  models: {
    model: string;
    provider: string;
    modelVersion?: string;
    runConfigurationFingerprint: string;
    servingProviders: string[];
    runId: string;
    passed: number;
    total: number;
    passRate: number;
    toolCalls: number;
    transactions: number;
    gasUsed: string;
    safetyPassed: number;
    modelCostUsd: string | null;
    modelCostComplete: boolean;
    relativeToFirst: { gained: string[]; lost: string[] };
  }[];
  tasks: { taskId: string; outcomes: boolean[] }[];
}

export function compareSuiteReports(reports: readonly SuiteReport[]): ComparisonReport {
  if (reports.length < 2) throw new Error("At least two reports are required");
  const first = reports[0];
  for (const report of reports) {
    if (report.schemaVersion !== 1 || report.complete !== true ||
        typeof report.runConfigurationFingerprint !== "string" ||
        typeof report.provider !== "string" ||
        !report.totals || typeof report.totals.modelCostComplete !== "boolean" ||
        report.suiteFingerprint !== first.suiteFingerprint ||
        report.total !== first.total || report.tasks.length !== first.tasks.length ||
        report.tasks.some((task, index) =>
          task.taskId !== first.tasks[index].taskId ||
          task.taskFingerprint !== first.tasks[index].taskFingerprint)) {
      throw new Error("Reports do not cover the same ordered task definitions");
    }
  }
  return {
    schemaVersion: 1,
    suiteId: first.suiteId,
    suiteFingerprint: first.suiteFingerprint,
    models: reports.map((report) => ({
      model: report.model,
      provider: report.provider,
      modelVersion: report.modelVersion,
      runConfigurationFingerprint: report.runConfigurationFingerprint,
      servingProviders: report.servingProviders,
      runId: report.runId,
      passed: report.passed,
      total: report.total,
      passRate: report.passRate,
      toolCalls: report.totals.toolCalls,
      transactions: report.totals.transactions,
      gasUsed: report.totals.gasUsed,
      safetyPassed: report.safetyPassed,
      modelCostUsd: report.totals.modelCostUsd,
      modelCostComplete: report.totals.modelCostComplete,
      relativeToFirst: {
        gained: report.tasks.filter((task, index) => task.success && !first.tasks[index].success)
          .map((task) => task.taskId),
        lost: report.tasks.filter((task, index) => !task.success && first.tasks[index].success)
          .map((task) => task.taskId),
      },
    })),
    tasks: first.tasks.map((task, index) => ({
      taskId: task.taskId,
      outcomes: reports.map((report) => report.tasks[index].success),
    })),
  };
}

export function renderComparisonMarkdown(comparison: ComparisonReport): string {
  const lines = [
    `# Model comparison — ${comparison.suiteId}`,
    "",
    `Suite fingerprint: \`${comparison.suiteFingerprint}\``,
    "",
    "| Model | Provider | Served by | Settings hash | Run | Passed | Safety | Pass rate | Model USD | Tool calls | Transactions | Gas | Gains vs first | Losses vs first |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const model of comparison.models) {
    lines.push(
      `| ${escapeCell(model.model)} | ${escapeCell(model.provider)} | ${escapeCell(model.servingProviders.join(", ") || "unknown")} | ` +
      `\`${model.runConfigurationFingerprint.slice(0, 12)}\` | \`${model.runId}\` | ${model.passed}/${model.total} | ` +
      `${model.safetyPassed}/${model.total} | ${(model.passRate * 100).toFixed(1)}% | ` +
      `${model.modelCostUsd ?? "unknown"}${model.modelCostComplete ? "" : "*"} | ${model.toolCalls} | ` +
      `${model.transactions} | ${model.gasUsed} | ${model.relativeToFirst.gained.length} | ` +
      `${model.relativeToFirst.lost.length} |`,
    );
  }
  lines.push("", `| Task | ${comparison.models.map((model) => escapeCell(`${model.model} (${model.runConfigurationFingerprint.slice(0, 8)})`)).join(" | ")} |`);
  lines.push(`| --- | ${comparison.models.map(() => "---").join(" | ")} |`);
  for (const task of comparison.tasks) {
    lines.push(`| ${escapeCell(task.taskId)} | ${task.outcomes.map((passed) => passed ? "PASS" : "FAIL").join(" | ")} |`);
  }
  lines.push("", "*Model cost may be incomplete. Only reports with identical task fingerprints can be compared.", "");
  return lines.join("\n");
}

export async function compareSavedReports(
  reportPaths: readonly string[],
  outputDir: string,
): Promise<ComparisonReport> {
  const reports = await Promise.all(reportPaths.map(async (path) =>
    JSON.parse(await readFile(resolve(path), "utf8")) as SuiteReport,
  ));
  const comparison = compareSuiteReports(reports);
  const absolute = resolve(outputDir);
  await mkdir(absolute, { recursive: true });
  await Promise.all([
    writeJson(join(absolute, "comparison.json"), comparison, []),
    writeFile(join(absolute, "comparison.md"), renderComparisonMarkdown(comparison), "utf8"),
  ]);
  return comparison;
}
