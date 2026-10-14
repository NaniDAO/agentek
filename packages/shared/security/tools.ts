/** ScamSniffer scam-database, GPL-3.0. Existing delayed blacklist coverage only. */
import { createTool } from "../client.js";
import { z } from "zod";
import { identityAddress } from "../utils/exact.js";
import { assertOkResponse, readBoundedJSON } from "../utils/fetch.js";

const BASE = "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist";
const TTL = 86400000;
const caches: Record<string, { values: Set<string>; observed: number }> = {};
function domain(value: string) {
  const url = new URL(value.includes("://") ? value : "https://" + value);
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname) throw new Error("Unreadable website domain");
  return url.hostname.toLowerCase().replace(/^www\./, "");
}
async function observe(kind: "address" | "domains", subject: string) {
  const now = Date.now(), source = `${BASE}/${kind}.json`;
  let cache = caches[kind], refreshOutcome = "not-needed", refreshError: string | null = null;
  if (!cache || now - cache.observed >= TTL) {
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
      await assertOkResponse(response, "Blacklist refresh failed");
      const values = await readBoundedJSON(response, 64 * 1024 * 1024);
      if (!Array.isArray(values) || !values.length || values.length > 1000000 || values.some(v => typeof v !== "string" || v.length > 253 || (kind === "address" ? !/^0x[0-9a-fA-F]{40}$/.test(v) : !v || /[\s/:]/.test(v)))) throw new Error("Unreadable blacklist coverage");
      cache = { values: new Set(values.map(v => v.toLowerCase())), observed: Date.now() };
      caches[kind] = cache; refreshOutcome = "success";
    } catch { refreshOutcome = "failure"; refreshError = "Refresh failed or coverage unreadable"; }
  }
  const fresh = !!cache && Date.now() - cache.observed < TTL;
  const match = cache?.values.has(subject) ?? false;
  const result = match ? "positive" : fresh ? "negative" : "unknown";
  return { schemaVersion: 1, source, observedAt: cache ? new Date(cache.observed).toISOString() : null,
    checkedAt: new Date().toISOString(), expiresAt: cache ? new Date(cache.observed + TTL).toISOString() : null,
    freshness: fresh ? "fresh" : cache ? "stale" : "unknown", refreshOutcome, refreshError,
    result, isMalicious: match ? true : fresh ? false : null,
    coverage: { status: cache ? "partial" : "unknown", entries: cache?.values.size ?? null, detail: "ScamSniffer delayed blacklist only; a negative is not proof of safety. Stale positives remain useful." } };
}
export const checkMaliciousAddress = createTool({ name: "checkMaliciousAddress", description: "Observe a delayed address blacklist match with freshness and refresh evidence. Unknown is never a clean negative.",
  parameters: z.object({ address: identityAddress }).strict(), execute: async (_client, args) => ({ address: args.address, ...await observe("address", args.address.toLowerCase()) }) });
export const checkMaliciousWebsite = createTool({ name: "checkMaliciousWebsite", description: "Observe an existing delayed domain blacklist match with freshness and refresh evidence. Stale malicious positives are retained.",
  parameters: z.object({ website: z.string().min(1).max(2048) }).strict(), execute: async (_client, args) => ({ website: args.website, ...await observe("domains", domain(args.website)) }) });
