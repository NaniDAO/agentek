import { getConfigDir, resolveKeys } from "../config.js";
import { sanitizeToolOutput } from "@agentek/tools/client";

/** Structured error codes for agent-friendly error classification. */
export type ErrorCode =
  | "UNKNOWN_TOOL"
  | "MISSING_API_KEY"
  | "VALIDATION_ERROR"
  | "CHAIN_NOT_SUPPORTED"
  | "TIMEOUT"
  | "EXECUTION_ERROR"
  | "INVALID_ARGS";

/** JSON.stringify replacer that converts BigInt to string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Remove configured credentials and local config paths from error output. */
export function scrubSecrets(message: string): string {
  const keys = configuredKeys();
  let output = message;
  for (const [name, value] of Object.entries(keys).sort((a, b) => (b[1]?.length ?? 0) - (a[1]?.length ?? 0))) {
    if (value && value.length >= 8 && /PRIVATE_KEY|API_KEY|SECRET|TOKEN|PASSWORD|JWT|BEARER/.test(name)) output = output.replaceAll(value, `[REDACTED:${name}]`);
  }
  return sanitizeToolOutput(output, undefined, keys).replaceAll(getConfigDir(), "[CONFIG_DIR]");
}

function configuredKeys(): Record<string, string | undefined> {
  try { return resolveKeys(); } catch { return {}; }
}

/** Write JSON to stdout and exit 0. */
export function outputJson(data: unknown): never {
  process.stdout.write(JSON.stringify(sanitizeToolOutput(data, undefined, configuredKeys()), bigintReplacer, 2) + "\n");
  process.exit(0);
}

/** Write JSON error to stderr and exit 1. */
export function outputError(
  msg: string,
  opts?: { code?: ErrorCode; hint?: string; retryable?: boolean; details?: unknown },
): never {
  const payload: Record<string, unknown> = { error: scrubSecrets(msg) };
  if (opts?.details !== undefined) payload.details = sanitizeToolOutput(opts.details, undefined, configuredKeys());
  if (opts?.code) payload.code = opts.code;
  if (opts?.hint) payload.hint = scrubSecrets(opts.hint);
  if (opts?.retryable !== undefined) payload.retryable = opts.retryable;
  process.stderr.write(JSON.stringify(payload, bigintReplacer) + "\n");
  process.exit(1);
}
