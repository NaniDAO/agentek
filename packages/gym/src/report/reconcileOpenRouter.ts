import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { lookupOpenRouterGeneration } from "../agents/OpenRouterAgentAdapter.js";
import { aggregateCost, type ModelCallTrace } from "../runner/dimensions.js";
import type { EvaluationResult, EvaluationTrace } from "../runner/runEvaluation.js";
import { renderSuiteMarkdown, type SuiteReport } from "./suite.js";

function inside(root: string, path: string): string {
  const absolute = resolve(root, path);
  const child = relative(root, absolute);
  if (isAbsolute(path) || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Artifact path escapes run directory: ${path}`);
  }
  return absolute;
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, value, "utf8");
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Refresh existing generation metadata without making new inference calls. */
export async function reconcileOpenRouterReport(
  runDirectory: string,
  apiKey: string,
  generationEndpoint?: string,
): Promise<SuiteReport> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for metadata reconciliation");
  const root = resolve(runDirectory);
  const lockPath = resolve(root, ".run.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Cannot reconcile a run while it is active");
    }
    throw error;
  }
  try {
    const report = JSON.parse(await readFile(resolve(root, "report.json"), "utf8")) as SuiteReport;
    if (report.schemaVersion !== 1 || report.provider !== "openrouter") {
      throw new Error("Expected an OpenRouter Gym suite report");
    }
    for (const task of report.tasks) {
      const resultPath = inside(root, task.resultPath);
      const tracePath = inside(root, task.tracePath);
      const result = JSON.parse(await readFile(resultPath, "utf8")) as EvaluationResult;
      const trace = JSON.parse(await readFile(tracePath, "utf8")) as EvaluationTrace;
      if (result.taskId !== task.taskId || trace.taskId !== task.taskId ||
          result.runId !== trace.runId) {
        throw new Error(`Saved artifacts do not match task ${task.taskId}`);
      }
      const calls: ModelCallTrace[] = [];
      for (const call of trace.modelCalls ?? []) {
        const updated = { ...call };
        if (call.generationId) {
          try {
            const metadata = await lookupOpenRouterGeneration(
              call.generationId, apiKey, generationEndpoint,
            );
            updated.servingProvider = metadata.providerName ?? updated.servingProvider;
            updated.resolvedModel = metadata.model ?? updated.resolvedModel;
            updated.costUsd = metadata.totalCostUsd ?? updated.costUsd;
            updated.metadataError = undefined;
          } catch (error) {
            updated.metadataError = error instanceof Error ? error.message : String(error);
          }
        }
        calls.push(updated);
      }
      trace.modelCalls = calls;
      result.modelCalls = calls;
      result.cost = aggregateCost(result.metrics.modelRequests ?? calls.length, calls, trace.transactions);
      task.cost = result.cost;
      task.modelRequests = result.metrics.modelRequests;
      task.servingProviders = [...new Set(calls.map((call) => call.servingProvider)
        .filter((value): value is string => Boolean(value)))].sort();
      task.resolvedModels = [...new Set(calls.map((call) => call.resolvedModel)
        .filter((value): value is string => Boolean(value)))].sort();
      await atomicWrite(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
      await atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    report.servingProviders = [...new Set(report.tasks.flatMap((task) => task.servingProviders))].sort();
    report.resolvedModels = [...new Set(report.tasks.flatMap((task) => task.resolvedModels))].sort();
    report.totals.modelRequests = report.tasks.reduce((sum, task) => sum + (task.modelRequests ?? 0), 0);
    report.totals.promptTokens = report.tasks.reduce((sum, task) => sum + task.cost.promptTokens, 0);
    report.totals.completionTokens = report.tasks.reduce((sum, task) => sum + task.cost.completionTokens, 0);
    report.totals.modelCostComplete = report.tasks.every((task) => task.cost.modelCostComplete);
    const costs = report.tasks.flatMap((task) => task.cost.modelCostUsd === null
      ? [] : [parseUnits(task.cost.modelCostUsd, 12)]);
    report.totals.modelCostUsd = costs.length
      ? formatUnits(costs.reduce((sum, cost) => sum + cost, 0n), 12)
      : null;
    await atomicWrite(resolve(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(resolve(root, "report.md"), renderSuiteMarkdown(report));
    return report;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
