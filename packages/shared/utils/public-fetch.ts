import { readBoundedBytes, withAbort, createDeadline } from "./fetch.js";
const MAX_BYTES = 2 * 1024 * 1024;

/** A deliberately conservative public-address policy, applied after DNS too. */
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes(":")) {
    // Global unicast only; exclude documentation, transition and special ranges.
    return /^[23][0-9a-f]{3}:/.test(ip) && !/^(2001:db8:|2002:|3fff:)/.test(ip) && !(ip.startsWith("2001:") && parseInt(ip.split(":")[1] || "0", 16) < 0x200);
  }
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

/**
 * Fetch untrusted URLs with a validated DNS address pinned to the connection.
 * Browser hosts must supply their own equivalent transport; ordinary fetch
 * cannot establish this property (DNS validation followed by fetch can rebind).
 */
export async function publicFetch(input: string | URL | Request, init: RequestInit = {}, maximumBytes = MAX_BYTES): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Public HTTP(S) URL without credentials required");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || !hostname.includes("." ) && !hostname.includes(":")) throw new Error("Private destination forbidden");
  const deadline = createDeadline(request.signal, 15000);
  const signal = deadline.signal;
  try {
  const body = await readBoundedBytes(request.body, maximumBytes, signal);
  const native = (globalThis as any).__agentekPublicFetch;
  if (typeof process === "undefined" || !process.versions?.node) {
    if (typeof native !== "function") throw new Error("Secure public HTTP transport is unavailable in this host");
    const response = await withAbort(Promise.resolve(native(new Request(request.url, {method: request.method, headers: request.headers, signal, ...(!["GET", "HEAD"].includes(request.method) ? {body} : {})}), { maximumBytes, timeoutMs: 15000, redirect: "error" })), signal);
    if (!(response instanceof Response) || response.status >= 300 && response.status < 400) throw new Error("Invalid native public response or redirect");
    const bytes = await readBoundedBytes(response.body, maximumBytes, signal);
    return new Response([204,205,304].includes(response.status) ? null : bytes, {status: response.status, headers: response.headers});
  }
  // Variable imports keep Node transports out of the JavaScriptCore bundle.
  const load = (module: string): Promise<any> => import(module);
  const [{ lookup }, { isIP }, transport, zlib] = await Promise.all([
    load("node:dns/promises"), load("node:net"), load(url.protocol === "https:" ? "node:https" : "node:http"), load("node:zlib"),
  ]);
  signal.throwIfAborted();
  const addresses: any[] = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] :
    await withAbort(lookup(hostname, { all: true, verbatim: true }), signal) as any[];
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error("Private or reserved destination forbidden");
  const pinned = addresses[0];
  return await new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    headers["accept-encoding"] = "gzip, deflate, br";
    delete headers.host;
    const req = transport.request(url, { method: request.method, headers, agent: false, signal,
      lookup: (_host: string, options: any, callback: any) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, (res: any) => {
      if (!Number.isInteger(res.statusCode) || res.statusCode < 200 || res.statusCode > 599) { res.destroy(); reject(new Error("Invalid HTTP response status")); return; }
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); reject(new Error("Redirects forbidden for untrusted URLs")); return; }
      let compressed = 0, size = 0;
      res.on("data", (chunk: Uint8Array) => { compressed += chunk.byteLength; if (compressed > maximumBytes) req.destroy(new Error("Response body too large")); });
      const encoding = res.headers["content-encoding"];
      const decoded = encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) : encoding === "gzip" || encoding === "deflate" ? res.pipe(zlib.createUnzip()) : res;
      if (encoding && !["identity", "br", "gzip", "deflate"].includes(encoding)) { req.destroy(new Error("Unsupported response encoding")); return; }
      const chunks: Uint8Array[] = [];
      decoded.on("data", (chunk: Uint8Array) => {
        size += chunk.byteLength;
        if (size > maximumBytes) { decoded.destroy(); req.destroy(new Error("Response body too large")); return; }
        chunks.push(chunk);
      });
      decoded.on("error", reject); res.on("error", reject);
      decoded.on("end", () => {
        try {
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined && !["content-encoding", "content-length"].includes(key)) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : String(value));
        resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : bytes, { status: res.statusCode, headers: responseHeaders }));
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
  } finally { deadline.dispose(); }
}
