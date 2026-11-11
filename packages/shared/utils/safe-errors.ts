/** Output boundaries must never expose provider errors or configured credentials. */
export interface OutputClient {
  getPublicClients?(): Map<number, { transport?: unknown }>;
  getSolanaRpcUrl?(): string;
}

type ConfiguredValues = Record<string, unknown>;
const REDACTED = "[REDACTED]";
const credentialName = /(?:PRIVATE_KEY|API_KEY|SECRET|TOKEN|PASSWORD|JWT|RPC_URL|BEARER)/i;
const transactionHash = /^0x[\da-f]{64}$/i;
function percentEncode(value: string): string { try { return encodeURIComponent(value); } catch { return value; } }

function variants(value: string): string[] {
  const values = new Set([value]);
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      values.add(next); decoded = next;
    } catch { break; }
  }
  return [...values];
}

/** Collect only credential-bearing configuration, including URL components. */
export function collectOutputSecrets(client?: OutputClient, configured: ConfiguredValues = {}) {
  const secrets = new Set<string>();
  const origins = new Set<string>();
  const urls = new Set<string>();
  const routingEvidence = new Set<string>();
  const credentials = new Set<string>();
  const addSecret = (value: string, route = false) => {
    for (const item of variants(value)) {
      if (!item) continue;
      if (route && (/^\d+$/.test(item) || transactionHash.test(item))) routingEvidence.add(item);
      else credentials.add(item);
      secrets.add(item);
      secrets.add(percentEncode(item));
    }
  };
  const addUrl = (input: string) => {
    for (const value of variants(input)) {
      try {
        const url = new URL(value);
        if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol)) continue;
        origins.add(url.origin);
        urls.add(value);
        // Numeric and hash-shaped credentials are still credentials. Only
        // path routing components may coincide with public execution evidence.
        for (const part of [url.username, url.password, ...url.searchParams.values(), url.hash.slice(1)]) addSecret(part);
        for (const part of url.pathname.split("/")) addSecret(part, true);
      } catch { /* A malformed endpoint is not suitable for output either. */ }
    }
  };
  let env: ConfiguredValues = {};
  try { if (typeof process !== "undefined") env = process.env; } catch {}
  for (const [name, raw] of Object.entries({ ...env, ...configured })) {
    if (typeof raw !== "string" || !raw || !credentialName.test(name)) continue;
    if (/RPC_URLS$/i.test(name)) {
      for (const entry of raw.split(",")) {
        const separator = entry.indexOf("=");
        addUrl(separator >= 0 ? entry.slice(separator + 1).trim() : entry.trim());
      }
    } else if (/RPC_URL/i.test(name)) addUrl(raw);
    else addSecret(raw);
  }
  // viem fallback transports nest their transports in `value` or `transports`.
  const visited = new WeakSet<object>();
  const transportUrls = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 8 || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === "url" && typeof child === "string") addUrl(child);
      else if (child && typeof child === "object") transportUrls(child, depth + 1);
    }
  };
  try { for (const publicClient of client?.getPublicClients?.().values() ?? []) transportUrls(publicClient.transport); } catch {}
  try { const url = client?.getSolanaRpcUrl?.(); if (url) addUrl(url); } catch {}
  return { secrets: [...secrets].sort((a, b) => b.length - a.length), origins, urls, routingEvidence, credentials };
}

/** Fixed messages intentionally omit unknown provider text, bodies and causes. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "Request timed out";
  return "Tool execution failed";
}

function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Includes mixed percent encoding, rather than only a single encoded variant. */
function secretPattern(secret: string): RegExp {
  const pattern = [...secret].map(character => {
    const encoded = percentEncode(character);
    return encoded === character && /^[\x20-\x7e]$/.test(character)
      ? `(?:${escaped(character)}|%${character.charCodeAt(0).toString(16).padStart(2, "0")})`
      : `(?:${escaped(character)}|${escaped(encoded)})`;
  }).join("");
  return new RegExp(pattern, "gi");
}

/** Redact nested partial successes as well as top-level errors. */
export function sanitizeToolOutput<T>(value: T, client?: OutputClient, configured: ConfiguredValues = {}): T {
  const context = collectOutputSecrets(client, configured);
  const patterns = context.secrets.map(secret => {
    const pattern = secretPattern(secret);
    return secret.length < 4 ? new RegExp(`(?<![A-Za-z0-9])${pattern.source}(?![A-Za-z0-9])`, "gi") : pattern;
  });
  const scrub = (input: string) => {
    let text = input.replace(/(?:https?|wss?):\/\/[^\s<>"'\\]+/gi, candidate => {
      try {
        const url = new URL(candidate);
        return context.origins.has(url.origin) || url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|password|auth/i.test(key))
          ? url.origin : candidate;
      } catch { return candidate; }
    });
    for (const url of context.urls) text = text.replaceAll(url, REDACTED);
    for (const pattern of patterns) text = text.replace(pattern, REDACTED);
    return text;
  };
  const seen = new WeakMap<object, unknown>();
  const walk = (item: unknown, key = ""): unknown => {
    if (typeof item === "string") {
      const evidenceField = /^(?:hash|transactionHash|blockHash|signature|quantity|chainId|nonce|gas|gasPrice|value|amount|balance|blockNumber|timestamp|decimals|supply|.*Raw)$/i.test(key);
      if (evidenceField && context.routingEvidence.has(item) && !context.credentials.has(item)) return item;
      return scrub(item);
    }
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return seen.get(item);
    if (item instanceof Date || item instanceof Uint8Array) return item;
    const output: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : {};
    seen.set(item, output);
    if (item instanceof Error) {
      (output as Record<string, unknown>).message = safeErrorMessage(item);
      const executionError = ["OperationExecutionError", "TransactionExecutionError", "SolanaExecutionError"].includes(item.name);
      (output as Record<string, unknown>).name = executionError ? item.name : "Error";
      if (executionError) {
        const metadata = item as Error & Record<string, unknown>;
        for (const key of ["retryable", "execution", "completed", "failedIndex", "transaction"]) {
          if (key in item) (output as Record<string, unknown>)[key] = walk(metadata[key], key);
        }
      }
      return output;
    }
    for (const [key, child] of Object.entries(item)) {
      Object.defineProperty(output, scrub(key), { value: walk(child, key), enumerable: true, configurable: true, writable: true });
    }
    return output;
  };
  return walk(value) as T;
}

/** Generic exception boundary; execution errors are preserved by the client. */
export function sanitizeToolError(error: unknown, _client?: OutputClient): Error {
  return new Error(safeErrorMessage(error));
}
