import { z } from "zod";
import { decodeFunctionData, hashTypedData, parseAbi, type Address, type Hex } from "viem";
import { createTool } from "../client.js";
import { abiWord, byteHex, identityAddress, quantitySchema, uint256, dynamicBytes } from "../utils/exact.js";
import { implementation } from "../gasestimator/batch.js";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase());
const range = z.object({ from: quantitySchema, through: quantitySchema }).strict();
const known = z.object({ hash, nonce: quantitySchema.refine(v => uint256(v) <= 0xffffffffn, "Queue nonce exceeds uint32"), transactionHash: hash.nullable() }).strict();
export const queueStateSchema = z.object({
  schemaVersion: z.literal(1), owner: identityAddress, chainId: z.number().int().positive().safe(), initialFloor: quantitySchema,
  checkpoint: z.object({ blockNumber: quantitySchema, blockHash: hash }).strict().nullable().default(null),
  coveredRanges: z.array(range).max(128), failedRanges: z.array(range).max(128), knownEntries: z.array(known).max(64),
}).strict();
const queueParameters = z.object({ owner: identityAddress, chainId: z.number().int().positive().safe(),
  ranges: z.array(range).min(1).max(12), previous: queueStateSchema.optional() }).strict();
type Range = z.infer<typeof range>;
const abi = parseAbi(["function execute(address target,uint256 value,bytes data,bytes signature)", "function executeQueued(address target,uint256 value,bytes data,uint32 nonce)"]);
const eventTopic = "0x51c73878bb39c9c6a51d06575b2b5c9a834b0d19fdabcafffd35907ee6fdcf39";
const hex = (n: bigint) => `0x${n.toString(16)}`;

export function mergeCoverage(ranges: Range[]): Range[] {
  const sorted = ranges.map(r => ({ from: uint256(r.from), through: uint256(r.through) })).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  const out: { from: bigint; through: bigint }[] = [];
  for (const r of sorted) {
    if (r.from > r.through) throw new Error("Invalid coverage range");
    const last = out[out.length - 1];
    if (last && r.from <= last.through + 1n) last.through = last.through > r.through ? last.through : r.through;
    else out.push({ ...r });
  }
  return out.map(r => ({ from: r.from.toString(), through: r.through.toString() }));
}
function subtractCoverage(gaps: Range[], covered: Range[]): Range[] {
  let result = mergeCoverage(gaps);
  for (const c of covered) {
    const lo = uint256(c.from), hi = uint256(c.through);
    result = result.flatMap(g => {
      const a = uint256(g.from), b = uint256(g.through);
      if (b < lo || a > hi) return [g];
      return [...(a < lo ? [{ from: a.toString(), through: (lo - 1n).toString() }] : []), ...(b > hi ? [{ from: (hi + 1n).toString(), through: b.toString() }] : [])];
    });
  }
  return result;
}
/** Bounds-check dynamic tails before viem decoding; reject oversized or overlapping tails. */
function readPayload(input: unknown) {
  const bytes = byteHex(input), selector = bytes.slice(0, 10);
  if (selector !== "0xda0980c7" && selector !== "0x7f576d13" || bytes.length < 10 + 4 * 64) throw new Error("Unknown queue transaction ABI");
  const body = ("0x" + bytes.slice(10)) as Hex;
  const offset = BigInt("0x" + bytes.slice(10 + 2 * 64, 10 + 3 * 64));
  dynamicBytes(body, offset, 128);
  if (selector === "0xda0980c7") {
    const signatureOffset = BigInt("0x" + bytes.slice(10 + 3 * 64, 10 + 4 * 64));
    const data = dynamicBytes(body, offset, 128);
    if (signatureOffset < offset + 32n + BigInt((data.length - 2) / 2 + 31) / 32n * 32n) throw new Error("Overlapping queue tails");
    dynamicBytes(body, signatureOffset, 128);
  }
  const decoded = decodeFunctionData({ abi, data: bytes });
  const [target, value, data] = decoded.args;
  return { target, valueRaw: value.toString(), data: byteHex(data) };
}

export const observeGuardianQueue = createTool({ name: "observeGuardianQueue", description: "Bounded read-only Nani guardian queue observations. Carries immutable historical coverage, retryable gaps and unreadable known entries. Native host owns persistence and removal approval; incomplete evidence never establishes safe removal.",
  parameters: queueParameters,
  execute: async (client, input) => {
    const args = queueParameters.parse(input), previous = args.previous;
    if (previous && (previous.owner !== args.owner || previous.chainId !== args.chainId)) throw new Error("Queue state identity mismatch");
    const rpc = client.getPublicClient(args.chainId);
    if (rpc.chain?.id !== args.chainId || await rpc.getChainId() !== args.chainId) throw new Error("Queue RPC chain mismatch");
    const block = await rpc.getBlock();
    if (typeof block.number !== "bigint" || !block.hash) throw new Error("Unknown queue block identity");
    if (previous?.coveredRanges.length) {
      if (!previous.checkpoint) throw new Error("Historical coverage lacks block identity; native migration must preserve uncertainty");
      const prior = await rpc.getBlock({ blockNumber: uint256(previous.checkpoint.blockNumber) });
      if (prior.hash?.toLowerCase() !== previous.checkpoint.blockHash) throw new Error("Historical checkpoint changed; coverage requires rescan");
    }
    const retries: Range[] = [];
    for (const gap of previous?.failedRanges ?? []) {
      let from = uint256(gap.from), through = uint256(gap.through);
      if (from > through) throw new Error("Invalid retryable gap");
      while (from <= through && retries.length < 12) {
        const to = from + 1999n < through ? from + 1999n : through;
        retries.push({ from: from.toString(), through: to.toString() }); from = to + 1n;
      }
    }
    const ranges = [...retries, ...args.ranges].filter((r, i, rows) => rows.findIndex(v => v.from === r.from && v.through === r.through) === i).slice(0, 12);
    for (const r of ranges) if (uint256(r.from) > uint256(r.through) || uint256(r.through) > block.number || uint256(r.through) - uint256(r.from) >= 2000n) throw new Error("Queue range outside bounds");
    const discovered = new Map((previous?.knownEntries ?? []).map(e => [e.hash, e]));
    const code = await rpc.getCode({ address: args.owner as Address, blockNumber: block.number });
    const delegation = code?.toLowerCase() === `0xef0100${implementation.slice(2)}` ? "verified" : "unknown";
    const succeeded: Range[] = [], failed: Range[] = [], evidence: { range: Range; status: string; reason?: string }[] = [];
    for (const r of ranges) {
      try {
        if (delegation !== "verified") throw new Error("Nani account delegation unreadable or unverified");
        const logs = await (rpc.request as any)({ method: "eth_getLogs", params: [{ address: args.owner, topics: [eventTopic], fromBlock: hex(uint256(r.from)), toBlock: hex(uint256(r.through)) }] });
        if (!Array.isArray(logs) || logs.length > 4096) throw new Error("Malformed or oversized queue log response");
        const additions = logs.map(log => {
          if (log.address?.toLowerCase() !== args.owner || log.removed !== false || !Array.isArray(log.topics) || log.topics.length !== 2 || log.topics[0]?.toLowerCase() !== eventTopic || !/^0x[0-9a-fA-F]{1,64}$/.test(log.blockNumber) || BigInt(log.blockNumber) < uint256(r.from) || BigInt(log.blockNumber) > uint256(r.through) || !/^0x[0-9a-fA-F]{128}$/.test(log.data)) throw new Error("Unreadable queue event");
          const nonce = BigInt("0x" + log.data.slice(2, 66));
          if (nonce > 0xffffffffn) throw new Error("Queue nonce exceeds uint32");
          return known.parse({ hash: log.topics[1], nonce: nonce.toString(), transactionHash: log.transactionHash });
        });
        if (new Set([...discovered.keys(), ...additions.map(e => e.hash)]).size > 64) throw new Error("Queue entry limit reached; range remains incomplete");
        for (const entry of additions) {
          const old = discovered.get(entry.hash);
          if (old && old.nonce !== entry.nonce) throw new Error("Conflicting queue nonce evidence");
          discovered.set(entry.hash, entry);
        }
        succeeded.push(r); evidence.push({ range: r, status: "verified" });
      } catch (err) { failed.push(r); evidence.push({ range: r, status: "failure", reason: err instanceof Error ? err.message : "Queue range read failed" }); }
    }
    let covered = mergeCoverage([...(previous?.coveredRanges ?? []), ...succeeded]);
    let gaps = subtractCoverage([...(previous?.failedRanges ?? []), ...failed], succeeded);
    const entries: any[] = [], retained: z.infer<typeof known>[] = [];
    for (const entry of discovered.values()) {
      try {
        if (delegation !== "verified") throw new Error("Unknown delegation");
        const response = await rpc.call({ to: args.owner as Address, blockNumber: block.number, data: ("0x228250c9" + entry.hash.slice(2)) as Hex });
        const eta = abiWord(response.data);
        if (eta === 0n) { entries.push({ ...entry, status: "cleared", etaRaw: "0", payload: null, payloadStatus: "unknown" }); continue; }
        retained.push(entry);
        let payload = null, payloadStatus = "unknown";
        try {
          if (!entry.transactionHash) throw new Error("Missing queue transaction");
          const tx = await rpc.getTransaction({ hash: entry.transactionHash as Hex });
          if (tx.to?.toLowerCase() !== args.owner || tx.hash.toLowerCase() !== entry.transactionHash || typeof tx.blockNumber !== "bigint" || tx.blockNumber > block.number) throw new Error("Queue transaction identity mismatch");
          const parsed = readPayload(tx.input);
          const digest = hashTypedData({ domain: { name: "Multisig", version: "1", chainId: args.chainId, verifyingContract: args.owner as Address },
            types: { Execute: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "nonce", type: "uint32" }] }, primaryType: "Execute",
            message: { target: parsed.target, value: uint256(parsed.valueRaw), data: parsed.data, nonce: Number(uint256(entry.nonce)) } });
          if (digest.toLowerCase() !== entry.hash) throw new Error("Queue payload digest mismatch");
          payload = parsed; payloadStatus = "verified";
        } catch { /* Preserve known entry, never display an invented payload. */ }
        entries.push({ ...entry, status: "queued", etaRaw: eta.toString(), payload, payloadStatus });
      } catch { retained.push(entry); entries.push({ ...entry, status: "unknown", etaRaw: null, payload: null, payloadStatus: "unknown", reason: "queued(hash) unreadable; entry retained" }); }
    }
    const end = await rpc.getBlock({ blockNumber: block.number });
    const stable = end.hash === block.hash;
    if (!stable) {
      covered = previous?.coveredRanges ?? []; gaps = mergeCoverage([...(previous?.failedRanges ?? []), ...ranges]);
      for (const entry of entries) { entry.status = "unknown"; entry.etaRaw = null; entry.payload = null; entry.payloadStatus = "unknown"; }
    }
    const state = { schemaVersion: 1 as const, owner: args.owner, chainId: args.chainId, initialFloor: previous?.initialFloor ?? ranges.reduce((a, r) => uint256(r.from) < uint256(a) ? r.from : a, ranges[0].from), coveredRanges: covered, failedRanges: gaps,
      checkpoint: stable ? { blockNumber: block.number.toString(), blockHash: block.hash.toLowerCase() } : previous?.checkpoint ?? null,
      knownEntries: stable ? retained : [...discovered.values()] };
    queueStateSchema.parse(state); // Never truncate retained coverage or entries to fit persistence.
    const contiguous = covered.find(r => uint256(r.through) >= block.number);
    const historyComplete = stable && delegation === "verified" && gaps.length === 0 && contiguous?.from === "0";
    return { schemaVersion: 1, owner: args.owner, chainId: args.chainId, source: "configured-rpc", observedAt: new Date().toISOString(),
      blockNumber: hex(block.number), blockHash: block.hash.toLowerCase(), delegation, state, entries, evidence,
      forwardHead: covered.length ? covered[covered.length - 1].through : null, oldestContiguousRange: covered[0] ?? null,
      historyComplete, status: historyComplete && entries.every(e => e.status !== "unknown" && (e.status === "cleared" || e.payloadStatus === "verified")) ? "verified" : "partial",
      removalSafety: "unknown", coverage: "Only successful explicit ranges. Earlier unscanned history and retryable gaps remain incomplete. Queue observations do not authorize removal." };
  },
});
