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
    const raw = flagArgs[timeoutIdx + 1];
    const parsed = Number(raw);
    if (!raw || Number.isNaN(parsed) || parsed <= 0) {
      outputError("--timeout requires a positive number (milliseconds)");
    }
    timeoutMs = parsed;
    flagArgs.splice(timeoutIdx, 2);
  }

  const flags = parseFlags(flagArgs, tool!.parameters);

  try {
    const result = await withTimeout(
      agentekClient.execute(toolName, flags),
      timeoutMs,
      toolName,
    );
    outputJson(result);
  } catch (err: any) {
    const msg: string = err.message || String(err);

    if (msg.includes("timed out after")) {
      const doubled = timeoutMs * 2;
      outputError(msg, {
        code: "TIMEOUT",
        hint: `Retry with a longer timeout: --timeout ${doubled}`,
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
