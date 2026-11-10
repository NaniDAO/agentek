import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecutionJournal, acknowledgeExecution, readExecutions } from "./journal.js";
import type { ExecutionRecord } from "../client.js";
const record = (id: string): ExecutionRecord => ({id, chainId: 1, status: "pending", operations: [{index: 0, op: {target: `0x${"1".repeat(40)}`, value: "1", data: "0x"}, status: "prepared"}]});
describe("persistent execution journal", () => {
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
      await acknowledgeExecution(root, a.id);
      const second = createExecutionJournal(root), b = record("reviewed");
      await second(b); b.status = "confirmed"; b.operations[0].status = "confirmed"; await second(b);
      await expect(readFile(join(root, "chain-1.lock"))).rejects.toThrow();
    } finally { await rm(root, {recursive: true, force: true}); }
  });
});
