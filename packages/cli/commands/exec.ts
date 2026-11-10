import { isNonCancellableTool, TransactionExecutionError, OperationExecutionError, failedResult } from "@agentek/tools/client";
import { outputJson, outputError } from "../utils/output.js";
import { unknownToolError, formatZodError, formatChainError } from "../utils/errors.js";
import { parseFlags } from "../utils/flags.js";
import { withTimeout } from "../utils/timeout.js";
import type { ClientContext } from "../utils/client.js";

const DEFAULT_TIMEOUT_MS = 120_000;


export async function handleExec(
  { agentekClient, toolsMap }: ClientContext,
  rest: string[],
): Promise<void> {
  const toolName = rest[0];
  if (!toolName) outputError("Usage: agentek exec <tool-name> [--key value ...]");

  const tool = toolsMap.get(toolName);
  if (!tool) unknownToolError(toolName, toolsMap);

  // Extract --timeout before parsing tool flags
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const flagArgs = rest.slice(1);
  const timeoutIdx = flagArgs.indexOf("--timeout");
  if (timeoutIdx !== -1) {
    if (isNonCancellableTool(tool!)) {
      outputError(
        `--timeout is not supported for ${toolName}; wait for its confirmationStatus and reconcile the returned signature before retrying`,
        { code: "INVALID_ARGS", retryable: false },
      );
    }
    const raw = flagArgs[timeoutIdx + 1];
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed) || parsed <= 0 || parsed > 2147483647) {
      outputError("--timeout requires a positive number (milliseconds)");
    }
    timeoutMs = parsed;
    flagArgs.splice(timeoutIdx, 2);
  }

  const flags = parseFlags(flagArgs, tool!.parameters);

  try {
    const execution = agentekClient.execute(toolName, flags);
    // These calls may have crossed the irreversible submission boundary when
    // the timer fires. Waiting for their explicit confirmationStatus is safer
    // than reporting a timeout that invites a duplicate retry.
    const result = isNonCancellableTool(tool!)
      ? await execution
      : await withTimeout(execution, timeoutMs, toolName);
    if (failedResult(result)) outputError("Tool returned no successful result", { code: "EXECUTION_ERROR", details: result });
    outputJson(result);
  } catch (err: any) {
    if (err instanceof OperationExecutionError) outputError(err.message, {code: "EXECUTION_ERROR", retryable: false, details: {failedIndex: err.failedIndex, completed: err.completed, transaction: err.transaction}});
    if (err instanceof TransactionExecutionError) outputError(err.message, { code: "EXECUTION_ERROR", retryable: false, details: err.execution });
    const msg: string = err.message || String(err);

    if (msg.includes("timed out after")) {
      const doubled = timeoutMs * 2;
      outputError(msg, {
        code: "TIMEOUT",
        hint: `Read timed out; retry with a longer timeout: --timeout ${doubled}`,
        retryable: true,
      });
    }

    const zodFormatted = formatZodError(msg, toolName);
    if (zodFormatted) {
      outputError(zodFormatted.message, {
        code: "VALIDATION_ERROR",
        hint: zodFormatted.hint,
        retryable: true,
      });
    }

    const chainFormatted = formatChainError(msg, tool!);
    if (chainFormatted) {
      outputError(chainFormatted.message, {
        code: "CHAIN_NOT_SUPPORTED",
        hint: chainFormatted.hint,
        retryable: true,
      });
    }

    outputError(msg, { code: "EXECUTION_ERROR" });
  }
}
