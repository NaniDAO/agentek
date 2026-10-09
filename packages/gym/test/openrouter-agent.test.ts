import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenRouterAgentAdapter } from "../src/agents/OpenRouterAgentAdapter.js";
import { reconcileOpenRouterReport } from "../src/report/reconcileOpenRouter.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouterAgentAdapter", () => {
  it("does not mistake an empty provider response for successful agent completion", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "", tool_calls: [] }, finish_reason: null }],
    }), { status: 200 }));
    await expect(new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key" }).run({
      objective: "Act", walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [], execute: async () => null, signal: new AbortController().signal,
    })).rejects.toThrow(/Empty assistant response/);
  });
  it("can use a local compatible endpoint without OpenRouter metadata lookups", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      urls.push(String(url));
      expect(JSON.parse(String(init.body)).reasoning_effort).toBe("none");
      return new Response(JSON.stringify({ id: "chatcmpl-local", model: "qwen3.5:2b-q4_K_M",
        choices: [{ message: { role: "assistant", content: "done" } }] }), { status: 200 });
    });
    const responses: any[] = [];
    await new OpenRouterAgentAdapter({ model: "qwen3.5:2b-q4_K_M", apiKey: "ollama",
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      reasoningEffort: "none",
      fetchGenerationMetadata: false }).run({
      objective: "Do nothing", walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [], execute: async () => null, signal: new AbortController().signal,
      recordModelResponse: (response) => responses.push(response),
    });
    expect(urls).toEqual(["http://127.0.0.1:11434/v1/chat/completions"]);
    expect(responses).toMatchObject([{ resolvedModel: "qwen3.5:2b-q4_K_M" }]);
  });
  it("gives the provider valid item schemas for Agentek's free-form ABI and args arrays", async () => {
    let parameters: any;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      parameters = JSON.parse(String(init.body)).tools[0].function.parameters;
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }),
        { status: 200 });
    });
    await new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key" }).run({
      objective: "Read", walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [{ name: "readContract", description: "Read", parameters: z.object({
        abi: z.array(z.any()).optional(), args: z.array(z.any()).optional(),
      }) }],
      execute: async () => null, signal: new AbortController().signal,
    });
    expect(parameters.properties.abi.items).toMatchObject({ type: "object" });
    expect(parameters.properties.abi.items.properties.inputs.items).toMatchObject({ type: "object" });
    expect(parameters.properties.args.items).toMatchObject({ type: "string" });
  });
  it("rejects a single-turn budget before any paid request", () => {
    expect(() => new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key",
      maxModelRequests: 1 })).toThrow(/one turn cannot reliably read then act/);
  });

  it("counts provider retries against the same HTTP request ceiling", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", async () => {
      posts += 1;
      if (posts === 1) return new Response(JSON.stringify({ choices: [{ message: {
        role: "assistant", content: null, tool_calls: [{ id: "read", function: {
          name: "getBalance", arguments: "{}",
        } }],
      } }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "Provider unavailable" } }), { status: 500 });
    });
    let recordedRequests = 0;
    await expect(new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key",
      maxModelRequests: 2 }).run({
      objective: "Read balance then act",
      walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [{ name: "getBalance", description: "Read", parameters: z.object({}) }],
      execute: async () => "2",
      recordModelRequest: () => { recordedRequests += 1; },
      signal: new AbortController().signal,
    })).rejects.toThrow(/OpenRouter HTTP 500/);
    expect(posts).toBe(2);
    expect(recordedRequests).toBe(2);
  });

  it("continues after a read, executes multiple action calls, and respects the task cap", async () => {
    const requests: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      const message = requests.length === 1
        ? { role: "assistant", content: null, tool_calls: [{ id: "read", function: {
          name: "getBalance", arguments: "{}",
        } }] }
        : { role: "assistant", content: null, tool_calls: ["first", "second"].map((id) => ({
          id, function: { name: "intentTransfer", arguments: JSON.stringify({ to: id }) },
        })) };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
    });
    const calls: string[] = [];
    const result = await new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key",
      maxModelRequests: 20 }).run({
      objective: "Read and make two transfers",
      walletAddress: "0x0000000000000000000000000000000000000001",
      maxModelRequests: 2,
      tools: [
        { name: "getBalance", description: "Read", parameters: z.object({}) },
        { name: "intentTransfer", description: "Transfer", parameters: z.object({ to: z.string() }) },
      ],
      execute: async (name, args) => { calls.push(`${name}:${JSON.stringify(args)}`); return "ok"; },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ completed: false, modelRequests: 2 });
    expect(requests).toHaveLength(2);
    expect(calls).toEqual([
      "getBalance:{}",
      'intentTransfer:{"to":"first"}',
      'intentTransfer:{"to":"second"}',
    ]);
  });

  it("converts selected Agentek tools and loops over a tool result", async () => {
    const requests: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      const response = requests.length === 1
        ? {
            choices: [{ message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-1",
                function: { name: "getBalance", arguments: JSON.stringify({
                  address: "0x0000000000000000000000000000000000000001",
                  chainId: 1,
                }) },
              }],
            } }],
          }
        : { choices: [{ message: { role: "assistant", content: "Balance is 2 ETH." } }] };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new OpenRouterAgentAdapter({ model: "test/model", apiKey: "test-key" });
    const calls: string[] = [];
    const result = await adapter.run({
      objective: "Check the balance",
      walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [{
        name: "getBalance",
        description: "Read ETH balance",
        parameters: z.object({ address: z.string(), chainId: z.number().optional() }),
      }],
      execute: async (name) => {
        calls.push(name);
        return "2";
      },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ completed: true, modelRequests: 2, output: "Balance is 2 ETH." });
    expect(calls).toEqual(["getBalance"]);
    expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(["getBalance"]);
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: "tool", tool_call_id: "call-1", content: '"2"',
    });
  });

  it("records the resolved model, serving provider, and billed cost from generation metadata", async () => {
    const seen: any[] = [];
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      fetches.push(String(url));
      if (String(url).includes("/generation?")) {
        return new Response(JSON.stringify({ data: {
          model: "google/gemini-versioned",
          provider_name: "Google Vertex",
          total_cost: 0.00125,
        } }), { status: 200 });
      }
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({ temperature: 0.2, top_p: 0.9, seed: 42,
        max_tokens: 512, provider: { only: ["google-vertex"], allow_fallbacks: false } });
      return new Response(JSON.stringify({
        id: "gen-123", model: "google/gemini-alias",
        usage: { prompt_tokens: 12, completion_tokens: 7, cost: 0.0009 },
        choices: [{ message: { role: "assistant", content: "done" } }],
      }), { status: 200 });
    });
    const adapter = new OpenRouterAgentAdapter({ model: "google/gemini-alias", apiKey: "test-key",
      temperature: 0.2, topP: 0.9, seed: 42, maxTokens: 512,
      providerRouting: { only: ["google-vertex"], allow_fallbacks: false },
      generationEndpoint: "https://openrouter.test/api/v1/generation" });
    await adapter.run({ objective: "Do nothing", walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [], execute: async () => null, signal: new AbortController().signal,
      recordModelResponse: (response) => seen.push(response) });
    expect(fetches).toHaveLength(2);
    expect(seen).toMatchObject([{ generationId: "gen-123", resolvedModel: "google/gemini-versioned",
      servingProvider: "Google Vertex", costUsd: "0.00125", promptTokens: 12, completionTokens: 7 }]);
  });

  it("waits for delayed generation metadata without creating another model response", async () => {
    let posts = 0;
    let lookups = 0;
    const recorded: any[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/generation?")) {
        lookups += 1;
        return new Response(JSON.stringify(lookups === 1 ? { error: "not ready" } : {
          data: { provider_name: "Google", model: "google/gemini-versioned", total_cost: 0.001 },
        }), { status: lookups === 1 ? 404 : 200 });
      }
      posts += 1;
      return new Response(JSON.stringify({ id: "gen-delayed", model: "google/gemini-alias",
        choices: [{ message: { role: "assistant", content: "done" } }] }), { status: 200 });
    });
    await new OpenRouterAgentAdapter({ model: "google/gemini-alias", apiKey: "test-key",
      generationEndpoint: "https://openrouter.test/api/v1/generation" }).run({
      objective: "Do nothing", walletAddress: "0x0000000000000000000000000000000000000001",
      tools: [], execute: async () => null, signal: new AbortController().signal,
      recordModelResponse: (response) => recorded.push(response),
    });
    expect(posts).toBe(1);
    expect(lookups).toBe(2);
    expect(recorded).toMatchObject([{ servingProvider: "Google",
      resolvedModel: "google/gemini-versioned", costUsd: "0.001" }]);
  });

  it("reconciles an existing report using metadata requests only", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentek-metadata-test-"));
    try {
      const taskDir = join(root, "tasks", "test");
      await mkdir(taskDir, { recursive: true });
      const call = { generationId: "gen-existing", requestedModel: "google/gemini-alias",
        resolvedModel: "google/gemini-alias", costUsd: "0.0008", metadataError: "HTTP 404",
        promptTokens: 12, completionTokens: 5 };
      const cost = { modelRequests: 1, promptTokens: 12, completionTokens: 5,
        modelCostUsd: "0.0008", modelCostComplete: true, gasFeeWeiByChain: {}, gasFeeComplete: true };
      await writeFile(join(taskDir, "trace.json"), JSON.stringify({ taskId: "test", runId: "run-1",
        modelCalls: [call], transactions: [] }));
      await writeFile(join(taskDir, "result.json"), JSON.stringify({ taskId: "test", runId: "run-1",
        metrics: { modelRequests: 1 }, modelCalls: [call], cost }));
      await writeFile(join(root, "report.json"), JSON.stringify({
        schemaVersion: 1, provider: "openrouter", model: "google/gemini-alias",
        suiteId: "test-suite", suiteFingerprint: "fingerprint", runId: "run-1",
        runConfigurationFingerprint: "settings", total: 1, completed: 1, passed: 1, safetyPassed: 1,
        servingProviders: [], resolvedModels: ["google/gemini-alias"],
        totals: { modelRequests: 1, promptTokens: 12, completionTokens: 5,
          modelCostUsd: "0.0008", modelCostComplete: true },
        tasks: [{ taskId: "test", success: true, graders: [], correctnessScore: 1,
          safety: { evaluated: false, passed: true }, cost, modelRequests: 1,
          steps: 0, transactions: 0, reverts: 0, gasUsed: "0", durationMs: 0,
          servingProviders: [], resolvedModels: [], resultPath: "tasks/test/result.json",
          tracePath: "tasks/test/trace.json" }],
      }));
      let posts = 0;
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        if (init?.method === "POST") posts += 1;
        return new Response(JSON.stringify({ data: { provider_name: "Google",
          model: "google/gemini-versioned", total_cost: 0.001 } }), { status: 200 });
      });
      const report = await reconcileOpenRouterReport(root, "test-key",
        "https://openrouter.test/api/v1/generation");
      expect(posts).toBe(0);
      expect(report.servingProviders).toEqual(["Google"]);
      expect(report.resolvedModels).toEqual(["google/gemini-versioned"]);
      expect(report.totals.modelCostUsd).toBe("0.001");
      expect(JSON.parse(await readFile(join(taskDir, "trace.json"), "utf8"))
        .modelCalls[0].metadataError).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
