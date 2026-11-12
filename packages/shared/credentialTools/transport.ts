import { readBoundedBytes, createDeadline } from "../utils/fetch.js";

export function installCredentialTransport(host: (request: unknown) => Promise<any>, protocol: 0 | 1, allowedOrigins: readonly string[]) {
  const origins = new Set(allowedOrigins);
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (!origins.has(new URL(request.url).origin)) return original(input, options);
    // No secrets cross into JavaScript; these headers are factory placeholders.
    const headers: Record<string, string> = {};
    for (const key of ['content-type', 'accept', 'x-nani-private']) {
      const value = request.headers.get(key);
      if (value) headers[key] = value;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const maximumBytes = 8 * 1024 * 1024;
    const deadline = createDeadline(request.signal, 30000);
    const signal = deadline.signal;
    let body: Uint8Array<ArrayBuffer>;
    try { signal.throwIfAborted(); body = await readBoundedBytes(request.body, maximumBytes, signal); } catch (error) { deadline.dispose(); throw error; }
    let abort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        if (protocol === 1) void Promise.resolve().then(() => host({type: 'cancel', requestId})).catch(() => undefined);
        reject(signal.reason ?? new Error('Credential request cancelled'));
      };
      signal.addEventListener('abort', abort, {once: true});
    });
    try {
      signal.throwIfAborted();
      const response = await Promise.race([host({...(protocol === 1 ? {type: 'request', requestId, maximumResponseBytes: maximumBytes, timeoutMs: 30000} : {}), url: request.url, method: request.method, headers, body: encodeBytes(body)}), cancelled]);
      if (response.error) throw new Error(response.error);
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
        throw new Error(`Provider request failed (HTTP ${response.status}). Check Tool API keys and your provider quota.`);
      }
      if (typeof response.body !== 'string' || response.body.length > Math.ceil(maximumBytes / 3) * 4) throw new Error('Provider response body too large or malformed');
      const decoded = Uint8Array.from(atob(response.body), c => c.charCodeAt(0));
      if (decoded.byteLength > maximumBytes) throw new Error('Provider response body too large');
      return new Response([204,205].includes(response.status) ? null : decoded, { status: response.status, headers: { 'content-type': 'application/json' } });
    } finally { signal.removeEventListener('abort', abort!); deadline.dispose(); }

  };
}

function encodeBytes(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
