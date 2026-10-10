import { keccak256, stringToHex } from "viem";
import { z } from "zod";

export const continuationSchema = z.string().max(12000).optional().describe("Opaque continuation returned by this read. Bound to network, address and filters. Never invent page numbers.");
type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown): string | null => typeof v === "string" && /^\d{1,78}$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
const address = (v: unknown): string | null => typeof v === "string" && /^0x[\da-fA-F]{40}$/.test(v) ? v : null;
const hash = (v: unknown): string | null => typeof v === "string" && /^0x[\da-fA-F]{64}$/.test(v) ? v : null;
const bounded = (v: unknown, max = 128): string | null => typeof v === "string" && v.length <= max ? v : null;
export class ReadFailure extends Error {
  constructor(public category: string, public retryable: boolean) { super(category); }
}
export function safeResearchError(operation: string, err: unknown) {
  const known = err instanceof ReadFailure;
  return { schemaVersion: 1, operation: operation.slice(0, 128), category: known ? err.category : "tool_failure",
    retryable: known ? err.retryable : false, partialResult: false, outcome: known ? "failed" : "unknown", message: "No successful result is available." };
}
function params(value: unknown): Record<string, string> | null {
  if (!object(value) || Object.keys(value).length > 24) return null;
  const out: Record<string, string> = {};
  for (const [k,v] of Object.entries(value)) {
    if (!/^[a-z_]{1,64}$/.test(k) || !["string", "number", "boolean"].includes(typeof v) || String(v).length > 256 || (typeof v === "number" && !Number.isSafeInteger(v))) return null;
    out[k] = String(v);
  }
  return out;
}
function transfer(v: unknown) {
  const x = object(v) ? v : {};
  const standard = bounded(x.token_type ?? x.token?.type, 16);
  const tokenId = exact(x.total?.token_id);
  return { sender: address(x.from?.hash), recipient: address(x.to?.hash), contract: address(x.token?.address_hash),
    standard, tokenId, quantity: standard === "ERC-721" ? "1" : exact(x.total?.value),
    transactionHash: hash(x.transaction_hash), logIndex: exact(x.log_index),
    // Batch sub-events must retain their upstream identity, including equal token IDs.
    batchIndex: exact(x.index_in_batch ?? x.batch_index), blockNumber: exact(x.block_number),
    blockHash: hash(x.block_hash), timestamp: bounded(x.timestamp, 64) };
}
function ownership(v: unknown) {
  const x = object(v) ? v : {};
  const instances = Array.isArray(x.token_instances) ? x.token_instances : [];
  if (instances.length > 100) throw new ReadFailure("record_too_large", false);
  return { contract: address(x.token?.address_hash), standard: bounded(x.token?.type, 16), quantity: exact(x.amount),
    tokens: instances.map((t: any) => ({ tokenId: exact(t?.id), quantity: exact(t?.value) })),
    tokenInstancesComplete: false };
}
export async function researchPage(operation: string, kind: "transfers" | "ownership", args: Obj, base: string, path: string) {
  const identity = JSON.stringify([String(args.chain), args.address.toLowerCase(), args.direction ?? "both", args.collection?.toLowerCase() ?? null, kind]);
  let query: Record<string,string> = {}, skip = 0, expected: string | undefined;
  if (args.continuation) {
    try {
      const c = JSON.parse(args.continuation);
      if (c.identity !== identity || !params(c.params) || !Number.isSafeInteger(c.skip) || c.skip < 0 || c.skip > 1000) throw 0;
      query = params(c.params)!; skip = c.skip; expected = c.fingerprint;
    } catch { throw new ReadFailure("invalid_continuation", false); }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let data: any;
  try {
    const suffix = Object.entries(query).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const response = await fetch(base + path + (suffix ? "?" + suffix : ""), { signal: controller.signal });
    if (!response.ok) throw new ReadFailure("upstream_http", response.status === 429 || response.status >= 500);
    try { data = await response.json(); } catch { throw new ReadFailure("malformed_response", false); }
  } catch (e) {
    if (e instanceof ReadFailure) throw e;
    throw new ReadFailure(controller.signal.aborted ? "timeout" : "transport", true);
  } finally { clearTimeout(timer); }
  if (!object(data) || !Array.isArray(data.items) || data.items.length > 1000) throw new ReadFailure("malformed_response", false);
  const records = data.items.map((v: unknown) => kind === "transfers" ? transfer(v) : ownership(v));
  const fingerprint = keccak256(stringToHex(JSON.stringify(records)));
  if (expected !== undefined && expected !== fingerprint) throw new ReadFailure("page_changed", true);
  const limit = args.limit ?? 10;
  const items: any[] = [], seen = new Set<string>();
  let unknown = 0, duplicates = 0, scanned = 0, i = skip;
  for (const r of records.slice(0,skip) as any[]) {
    if (r.transactionHash && r.logIndex !== null && r.blockHash && r.contract && (r.standard !== "ERC-1155" || r.batchIndex !== null))
      seen.add(JSON.stringify([r.blockHash,r.transactionHash,r.logIndex,r.batchIndex,r.contract,r.tokenId]));
  }
  for (; i < records.length; i++) {
    const r: any = records[i]; scanned++;
    if (kind === "transfers") {
      const id = r.transactionHash && r.logIndex !== null && r.blockHash && r.contract ? JSON.stringify([r.blockHash,r.transactionHash,r.logIndex,r.batchIndex,r.contract,r.tokenId]) : null;
      // Without batch identity, equal ERC1155 rows may be distinct: preserve them.
      if (id && (r.standard !== "ERC-1155" || r.batchIndex !== null)) {
        if (seen.has(id)) { duplicates++; continue; } seen.add(id);
      }
      if (Object.entries(r).some(([k,v]) => v === null && k !== "batchIndex" && !(k === "tokenId" && r.standard === "ERC-20"))) unknown++;
      if (args.direction === "outgoing" && r.sender?.toLowerCase() !== args.address.toLowerCase()) continue;
      if (args.direction === "incoming" && r.recipient?.toLowerCase() !== args.address.toLowerCase()) continue;
    }
    if (kind === "ownership" && (r.contract === null || r.standard === null || r.quantity === null || r.tokens.some((t: any) => t.tokenId === null || t.quantity === null))) unknown++;
    if (args.collection && r.contract?.toLowerCase() !== args.collection.toLowerCase()) continue;
    items.push(r);
    if (items.length === limit) { i++; break; }
  }
  let next: string | null = null, paginationUnknown = false;
  const encode = (p: Record<string,string>, offset: number, fp?: string) => JSON.stringify({ identity, params: p, skip: offset, ...(fp ? { fingerprint: fp } : {}) });
  if (i < records.length) next = encode(query, i, fingerprint);
  else if (data.next_page_params === null) { /* explicit endpoint exhaustion */ }
  else {
    const p = params(data.next_page_params);
    if (p && Object.keys(p).length && JSON.stringify(p) !== JSON.stringify(query)) next = encode(p, 0);
    else paginationUnknown = true;
  }
  // A replay fingerprint must itself remain bounded; fail explicitly instead of dropping rows.
  if (next && next.length > 12000) throw new ReadFailure("continuation_too_large", false);
  const blocks = records.slice(skip,i).map((r: any) => r.blockNumber).filter((b: any) => b !== null && b !== undefined);
  const exhausted = next === null && !paginationUnknown;
  const result = { schemaVersion: 1, operation, network: { namespace: "eip155", chainId: String(args.chain) }, kind,
    address: args.address, filters: { direction: args.direction ?? "both", collection: args.collection ?? null }, items,
    status: unknown || paginationUnknown ? "partial" : "ok",
    coverage: { scope: "explorer_indexed_history", scannedRecords: scanned, duplicatesRemoved: duplicates, unknownRecords: unknown,
      scannedBlockNumbers: blocks, endpointExhausted: exhausted, completeness: exhausted && !unknown ? "page_exhausted" : "incomplete",
      allRecipientsEstablished: false, limitations: ["Explorer indexing and reorg coverage are unverified. Accumulate every continuation; a terminal page alone does not prove earlier pages were read."] }, continuation: next };
  if (JSON.stringify(result).length > 64000) throw new ReadFailure("result_too_large", false);
  return result;
}
