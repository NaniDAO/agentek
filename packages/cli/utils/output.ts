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

/** Write JSON to stdout and exit 0. */
export function outputJson(data: unknown): never {
  process.stdout.write(JSON.stringify(data, bigintReplacer, 2) + "\n");
  process.exit(0);
}

/** Write JSON error to stderr and exit 1. */
export function outputError(
  msg: string,
  opts?: { code?: ErrorCode; hint?: string; retryable?: boolean },
): never {
  const payload: Record<string, unknown> = { error: msg };
  if (opts?.code) payload.code = opts.code;
  if (opts?.hint) payload.hint = opts.hint;
  if (opts?.retryable !== undefined) payload.retryable = opts.retryable;
  process.stderr.write(JSON.stringify(payload) + "\n");
  process.exit(1);
}
