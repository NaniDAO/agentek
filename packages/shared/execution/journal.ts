import { mkdir, rename, open, unlink, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionRecord } from "../client.js";

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
  if (record.status === "pending") {
    let running = true;
    try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") running = false; }
    if (running) throw new Error("An active process still owns this pending execution; stop it and reconcile before acknowledging");
  }
  await unlink(lockPath);
}
