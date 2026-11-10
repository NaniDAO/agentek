import { afterEach, describe, expect, it, vi } from "vitest";
import { AnvilForkEnvironment } from "../src/environment/AnvilForkEnvironment.js";
import { runEvaluation, fingerprintTask } from "../src/runner/runEvaluation.js";
import { parseTask } from "../src/task/loadTask.js";
const task = () => parseTask({id: "deadline", name: "Deadline", objective: "Read a balance", environment: {chain: "ethereum", blockNumber: 1}, wallet: {balances: {ETH: "1"}}, tools: ["getBalance"], limits: {maxSteps: 2, maxTransactions: 1, maxReverts: 0, timeoutMs: 20}, graders: [{type: "balance", asset: "ETH", operator: "gte", value: "1"}]});
afterEach(() => vi.restoreAllMocks());
describe("evaluation lifecycle", () => {
  it("bounds startup and shuts down the environment before returning a timeout", async () => {
    vi.spyOn(AnvilForkEnvironment.prototype, "start").mockImplementation(() => new Promise(() => {}));
    const stop = vi.spyOn(AnvilForkEnvironment.prototype, "stop").mockResolvedValue();
    const run = vi.fn();
    const result = await runEvaluation(task(), {run}, {upstreamRpcUrl: "http://127.0.0.1:1", model: "test"});
    expect(result.result.termination?.reason).toBe("TIMEOUT"); expect(result.result.success).toBe(false);
    expect(stop).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled();
  });
  it("includes an effective hardfork in task identity", () => {
    expect(fingerprintTask(task(), "cancun")).not.toBe(fingerprintTask(task(), "prague"));
  });
});
