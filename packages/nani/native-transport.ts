import { withAbort, createDeadline } from "../shared/utils/fetch.js";

/** App-injected, versioned capabilities. Missing flags retain the old bridge protocol. */
export function hostCapabilities() {
  const value = (globalThis as any).__agentekHostCapabilities;
  return value?.schemaVersion === 1 ? value : {};
}

export function installPublicTransport() {
  const handler = (globalThis as any).webkit?.messageHandlers?.agentekPublicFetch;
  if (hostCapabilities().publicFetch !== 1 || typeof handler?.postMessage !== "function") return;
  (globalThis as any).__agentekPublicFetch = async (request: Request, options: {maximumBytes: number; timeoutMs: number}) => {
    // The app independently enforces HTTPS, approved origins, public DNS,
    // connection pinning, no redirects, GET-only, byte bounds and cancellation.
    if (request.method !== "GET" || request.body) throw new Error("The native public transport supports GET only");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const deadline = createDeadline(request.signal, Math.min(options.timeoutMs, 15000));
    const cancel = () => { void Promise.resolve().then(() => handler.postMessage({type: "cancel", requestId: id})).catch(() => undefined); };
    deadline.signal.addEventListener("abort", cancel, {once: true});
    try {
      deadline.signal.throwIfAborted();
      const reply: any = await withAbort(Promise.resolve().then(() => { deadline.signal.throwIfAborted(); return handler.postMessage({type: "request", requestId: id,
        url: request.url, method: "GET", timeoutMs: Math.min(options.timeoutMs, 15000), maximumResponseBytes: Math.min(options.maximumBytes, 1_000_000)}); }), deadline.signal);
      if (reply?.error) throw new Error("Public metadata request unavailable");
      const maximum = Math.min(options.maximumBytes, 1_000_000);
      if (!Number.isInteger(reply?.status) || reply.status < 200 || reply.status > 599 || reply.status >= 300 && reply.status < 400 ||
          typeof reply.body !== "string" || reply.body.length > Math.ceil(maximum / 3) * 4) throw new Error("Invalid native public response");
      const decoded = atob(reply.body);
      if (decoded.length > maximum) throw new Error("Public metadata body too large");
      const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
      return new Response([204,205].includes(reply.status) ? null : bytes, {status: reply.status, headers: reply.headers ?? {}});
    } finally { deadline.signal.removeEventListener("abort", cancel); deadline.dispose(); }
  };
}
