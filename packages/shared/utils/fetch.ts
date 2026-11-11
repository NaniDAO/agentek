/**
 * Throws an error if the fetch response is not OK.
 */
export async function assertOkResponse(
  response: Response,
  context: string,
): Promise<void> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`${context}: HTTP ${response.status}`);
  }
}

/** Read a bounded UTF8 JSON body before parsing attacker-provided arrays. */
export async function readBoundedJSON(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<unknown> {
  const deadline = createDeadline(signal ?? new AbortController().signal, 15_000);
  try {
    if (!response.body) throw new Error("Missing response body");
    const bytes = await readBoundedBytes(response.body, maximumBytes, deadline.signal);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { deadline.dispose(); }
}

/** Abort a wait without allowing a late result to be consumed. */
export async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); signal.throwIfAborted(); }
  let abort: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error("Request aborted"));
    signal.addEventListener("abort", abort, {once: true});
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", abort!); }
}

class BodyLimitError extends Error {}

/** Bound streaming requests/responses before buffering; cancel stalled reads too. */
export async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("Invalid body size limit");
  if (signal.aborted) { void body?.cancel().catch(() => undefined); signal.throwIfAborted(); }
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await withAbort(reader.read(), signal);
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.byteLength > maximumBytes - size) throw new BodyLimitError("Body too large or malformed");
      size += value.byteLength; chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Works in embedded WebKit without requiring AbortSignal.any/timeout. */
export function createDeadline(parent: AbortSignal, milliseconds: number): {signal: AbortSignal; dispose: () => void} {
  const controller = new AbortController();
  const relay = () => controller.abort(parent.reason ?? new Error("Request cancelled"));
  const timer = setTimeout(() => controller.abort(new Error("Request deadline exceeded")), milliseconds);
  (timer as any).unref?.();
  if (parent.aborted) relay(); else parent.addEventListener("abort", relay, {once: true});
  return {signal: controller.signal, dispose: () => {clearTimeout(timer); parent.removeEventListener("abort", relay);}};
}

/** Fetch from a fixed provider with one deadline covering headers and body reads.
 * Never attach URLs, upstream status text, response bodies, or thrown messages to
 * public errors: provider URLs and diagnostics can contain credentials.
 */
/** Safe machine-readable failures for providers with explicit coverage status. */
export class ProviderRequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, readonly category: "upstream_http" | "malformed_response" | "timeout" | "transport", readonly status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.retryable = category === "timeout" || category === "transport" || category === "upstream_http" && (status === 429 || status >= 500);
  }
}
export type ProviderRequestOptions = {
  maximumBytes?: number;
  timeoutMs?: number;
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};
export async function providerBytes(
  input: string | URL,
  init: RequestInit = {},
  context = "Provider request failed",
  options: ProviderRequestOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const deadline = createDeadline(init.signal ?? new AbortController().signal, options.timeoutMs ?? 15_000);
  let response: Response | undefined;
  try {
    deadline.signal.throwIfAborted();
    const pending = (options.fetcher ?? fetch)(input, { ...init, redirect: "error", signal: deadline.signal });
    // An injected/native fetcher may resolve even after its signal is aborted.
    // Drop and close that late response too.
    void pending.then(late => { if (deadline.signal.aborted) void late.body?.cancel().catch(() => undefined); }).catch(() => undefined);
    response = await withAbort(pending, deadline.signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    return await readBoundedBytes(response.body, options.maximumBytes ?? 4 * 1024 * 1024, deadline.signal);
  } catch (error) {
    void response?.body?.cancel().catch(() => undefined);
    const category = response && !response.ok ? "upstream_http" : (deadline.signal.aborted || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? "timeout" : error instanceof BodyLimitError ? "malformed_response" : "transport";
    throw new ProviderRequestError(`${context}${response && !response.ok ? `: HTTP ${response.status}` : ": unavailable or invalid response"}`, category, response?.status);
  } finally { deadline.dispose(); }
}

export async function providerJSON<T = any>(
  input: string | URL,
  init: RequestInit = {},
  context = "Provider request failed",
  options: ProviderRequestOptions = {},
): Promise<T> {
  const bytes = await providerBytes(input, init, context, options);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
  catch { throw new ProviderRequestError(`${context}: invalid JSON response`, "malformed_response"); }
}
