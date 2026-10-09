#!/usr/bin/env node
// Run the same fixture against a local OpenAI-compatible Ollama server.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRouterAgentAdapter, runSuite } from "../../dist/index.js";

const root = dirname(fileURLToPath(import.meta.url));
const model = "qwen3.5:2b-q4_K_M";
const modelVersion = "124a03c34777";
const outputDir = resolve(process.env.GYM_OUTPUT_DIR ??
  join(root, "../../results/local-qwen35-2b-q4-nothink-20260923"));
const resume = process.argv.includes("--resume");
const stopIndex = process.argv.indexOf("--stop-after");
const stopAfter = stopIndex < 0 ? undefined : Number(process.argv[stopIndex + 1]);
if (stopAfter !== undefined && (!Number.isSafeInteger(stopAfter) || stopAfter < 1)) {
  throw new Error("--stop-after requires a positive integer");
}
const upstreamRpcUrl = process.env.ETHEREUM_RPC_URL;
const baseRpcUrl = process.env.BASE_RPC_URL;
if (!upstreamRpcUrl || !baseRpcUrl) {
  throw new Error("ETHEREUM_RPC_URL and BASE_RPC_URL must point to the local fixture upstreams");
}
const inferenceSettings = { maxModelRequests: 20, maxTokens: 768,
  quantization: "Q4_K_M", servingEndpoint: "local-ollama", reasoningEffort: "none" };
const report = await runSuite({
  manifestPath: join(root, "suite.json"), outputDir,
  model, modelVersion, provider: "ollama", inferenceSettings,
  upstreamRpcUrl, upstreamRpcUrls: { base: baseRpcUrl },
  agent: new OpenRouterAgentAdapter({ model, apiKey: "ollama",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    fetchGenerationMetadata: false,
    reasoningEffort: "none",
    maxModelRequests: 20, maxTokens: 768 }),
  resume, stopAfter,
});
console.log(`${report.passed}/${report.completed} passed (${report.completed}/${report.total} completed)`);
console.log(`JSON: ${join(outputDir, "report.json")}`);
console.log(`Markdown: ${join(outputDir, "report.md")}`);
if (report.complete && report.passed !== report.total) process.exitCode = 1;
