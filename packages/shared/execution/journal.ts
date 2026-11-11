import { mkdir, rename, open, unlink, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionRecord, SolanaExecutionRecord, ToolRequestRecord, ToolRequestStore } from "../client.js";

const validId = (id: string) => /^[a-zA-Z0-9-]+$/.test(id);
async function persist(directory: string, record: ExecutionRecord): Promise<void> {
  const path = join(directory, `${record.id}.json`), temporary = `${path}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(record, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** Atomically lock each chain across processes and persist before broadcasting. */
export function createExecutionJournal(directory: string) {
  const owned = new Set<string>();
  return async (record: ExecutionRecord): Promise<void> => {
    if (!validId(record.id) || !Number.isSafeInteger(record.chainId) || record.chainId <= 0) throw new Error("Invalid execution identity");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, `chain-${record.chainId}.lock`);
    if (!owned.has(record.id)) {
      let lock;
      try { lock = await open(lockPath, "wx", 0o600); }
      catch { throw new Error(`Chain ${record.chainId} is locked by an active or unresolved execution. Review the execution journal before acknowledging it.`); }
      try { await lock.writeFile(JSON.stringify({id: record.id, pid: process.pid})); await lock.sync(); } finally { await lock.close(); }
      owned.add(record.id);
    }
    await persist(directory, record);
    const noEffects = record.status === "failed" && record.operations.every(op => op.status === "prepared" || op.status === "signed");
    if (record.status === "confirmed" || noEffects) {
      await unlink(lockPath);
      owned.delete(record.id);
    }
  };
}

export async function readExecutions(directory: string): Promise<ExecutionRecord[]> {
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return Promise.all(names.filter(name => /^[a-zA-Z0-9-]+\.json$/.test(name)).sort().map(async name => JSON.parse(await readFile(join(directory, name), "utf8"))));
}

/** Explicit operator acknowledgement permits a later execution; it never resubmits. */
export async function acknowledgeExecution(directory: string, id: string): Promise<void> {
  if (!validId(id)) throw new Error("Invalid execution identity");
  const record: ExecutionRecord = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
  if (!Number.isSafeInteger(record.chainId) || record.chainId <= 0) throw new Error("Invalid journal chain");
  const lockPath = join(directory, `chain-${record.chainId}.lock`);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.id !== id) throw new Error("Execution does not own the chain lock");
  // Terminal persistence may still be followed by the owner's automatic unlink.
  // Acknowledgement must not release its lock while that process can resume.
  let running = true;
  try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") running = false; }
  if (running) throw new Error("An active process still owns this execution; stop it and reconcile before acknowledging");
  await unlink(lockPath);
}

async function atomicJSON(directory: string, name: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, name), temporary = `${destination}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** A reservation remains pending after any failure, including lost responses. */
export function createRequestJournal(directory: string): ToolRequestStore {
  const pathFor = (id: string) => {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(id)) throw new Error("Invalid request identity");
    return join(directory, `${id}.json`);
  };
  return {
    async claim(id, fingerprint) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let file;
      try { file = await open(pathFor(id), "wx", 0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        const saved = JSON.parse(await readFile(pathFor(id), "utf8")) as ToolRequestRecord;
        if (!saved || !["pending", "complete"].includes(saved.state) || typeof saved.fingerprint !== "string") throw new Error("Invalid request journal; reconcile before continuing");
        return saved;
      }
      try { await file.writeFile(JSON.stringify({ fingerprint, state: "pending" }) + "\n"); await file.sync(); }
      finally { await file.close(); }
      const dir = await open(directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
      return undefined;
    },
    async complete(id, fingerprint, result) {
      const saved = JSON.parse(await readFile(pathFor(id), "utf8")) as ToolRequestRecord;
      if (saved.fingerprint !== fingerprint || saved.state !== "pending") throw new Error("Request reservation mismatch");
      await atomicJSON(directory, `${id}.json`, { fingerprint, state: "complete", result });
    },
  };
}

/** Persist signed bytes/signature before Solana broadcast and retain unknown locks. */
export function createSolanaExecutionJournal(directory: string) {
  const owned = new Set<string>();
  return async (record: SolanaExecutionRecord): Promise<void> => {
    if (!validId(record.id)) throw new Error("Invalid Solana execution identity");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, "active.lock");
    if (!owned.has(record.id)) {
      let file;
      try { file = await open(lockPath, "wx", 0o600); }
      catch { throw new Error("Solana is locked by an active or unresolved execution; reconcile its stored signature first"); }
      try { await file.writeFile(JSON.stringify({ id: record.id, signature: record.signature, pid: process.pid })); await file.sync(); }
      finally { await file.close(); }
      owned.add(record.id);
    }
    await atomicJSON(directory, `${record.id}.json`, record);
    if (record.status === "confirmed" || record.status === "failed") {
      await unlink(lockPath); owned.delete(record.id);
    }
  };
}

export async function readSolanaExecutions(directory: string): Promise<SolanaExecutionRecord[]> {
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const records: SolanaExecutionRecord[] = [];
  for (const name of names.filter(name => /^[a-zA-Z0-9-]+\.json$/.test(name)).sort()) records.push(JSON.parse(await readFile(join(directory, name), "utf8")));
  return records;
}

/** Operator-only acknowledgement after reconciling the stored signature; never resubmits. */
export async function acknowledgeSolanaExecution(directory: string, id: string): Promise<void> {
  if (!validId(id)) throw new Error("Invalid Solana execution identity");
  const record = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")) as SolanaExecutionRecord;
  const lockPath = join(directory, "active.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.id !== id || lock.signature !== record.signature) throw new Error("Solana execution does not own the lock");
  let running = true;
  try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") running = false; }
  if (running) throw new Error("Stop the active signer and reconcile its signature before acknowledging");
  await unlink(lockPath);
}
