/**
 * Throws an error if the fetch response is not OK.
 */
export async function assertOkResponse(
  response: Response,
  context: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`${context}: ${response.status} ${response.statusText}`);
  }
}

/** Read a bounded UTF8 JSON body before parsing any attacker-provided arrays. */
export async function readBoundedJSON(response: Response, maximumBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.byteLength > maximumBytes - size) throw new Error("Oversized response body");
      size += value.byteLength; text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel(); reader.releaseLock(); }
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

/** Bound streaming requests/responses before buffering; cancel stalled reads too. */
export async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await withAbort(reader.read(), signal);
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.byteLength > maximumBytes - size) throw new Error("Body too large or malformed");
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
