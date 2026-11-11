import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createExecutionJournal, acknowledgeExecution, readExecutions, createSolanaExecutionJournal, acknowledgeSolanaExecution } from "./journal.js";
import type { ExecutionRecord } from "../client.js";
const record = (id: string): ExecutionRecord => ({id, chainId: 1, status: "pending", operations: [{index: 0, op: {target: `0x${"1".repeat(40)}`, value: "1", data: "0x"}, status: "prepared"}]});
describe("persistent execution journal", () => {
  it.each(["confirmed", "failed"] as const)("does not acknowledge a live EVM owner during %s persistence/release", async status => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-terminal-"));
    try {
      const a = record("first"); await createExecutionJournal(directory)(a);
      // The durable terminal record is visible before the owner unlinks its lock.
      await writeFile(join(directory, "first.json"), JSON.stringify({...a, status}));
      await expect(acknowledgeExecution(directory, a.id)).rejects.toThrow(/active process/);
      await expect(createExecutionJournal(directory)(record("second"))).rejects.toThrow(/locked/);
      expect(JSON.parse(await readFile(join(directory, "chain-1.lock"), "utf8")).id).toBe("first");
    } finally { await rm(directory, {recursive: true, force: true}); }
  });
  it.each(["confirmed", "failed"] as const)("does not acknowledge a live Solana owner during %s persistence/release", async status => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-solana-terminal-"));
    try {
      const a = {id: "first", signature: "first", transaction: "fixture", status: "signed" as const};
      await createSolanaExecutionJournal(directory)(a);
      await writeFile(join(directory, "first.json"), JSON.stringify({...a, status}));
      await expect(acknowledgeSolanaExecution(directory, a.id)).rejects.toThrow(/active signer/);
      await expect(createSolanaExecutionJournal(directory)({...a, id: "second", signature: "second"})).rejects.toThrow(/locked/);
      expect(JSON.parse(await readFile(join(directory, "active.lock"), "utf8")).id).toBe("first");
    } finally { await rm(directory, {recursive: true, force: true}); }
  });
  it("blocks another process or restarted client until an ambiguous execution is reviewed", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentek-journal-"));
    try {
      const first = createExecutionJournal(root), a = record("first");
      await first(a);
      await expect(acknowledgeExecution(root, a.id)).rejects.toThrow(/active process/);
      await expect(createExecutionJournal(root)(record("second"))).rejects.toThrow(/locked/);
      a.status = "unknown"; a.operations[0].status = "unknown"; a.operations[0].hash = `0x${"a".repeat(64)}`;
      await first(a);
      expect(await readExecutions(root)).toEqual([a]);
      await expect(createExecutionJournal(root)(record("third"))).rejects.toThrow(/locked/);
      await expect(acknowledgeExecution(root, a.id)).rejects.toThrow(/active process/);
      // Simulate the kernel's ESRCH after the owner has stopped. An unknown
      // record alone never establishes that the process stopped submitting.
      const stoppedOwner = vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("No such process"), { code: "ESRCH" }); });
      try { await acknowledgeExecution(root, a.id); }
      finally { stoppedOwner.mockRestore(); }
      const second = createExecutionJournal(root), b = record("reviewed");
      await second(b); b.status = "confirmed"; b.operations[0].status = "confirmed"; await second(b);
      await expect(readFile(join(root, "chain-1.lock"))).rejects.toThrow();
    } finally { await rm(root, {recursive: true, force: true}); }
  });
});
