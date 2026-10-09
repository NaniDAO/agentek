#!/usr/bin/env node
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OpenRouterAgentAdapter,
  fingerprintRunConfiguration,
  compareSavedReports,
  reconcileOpenRouterReport,
  runSuite,
} from "../dist/index.js";

function parseOptions(args) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--resume" || arg === "--no-fallbacks") {
      flags.set(arg, true);
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    flags.set(arg, value);
    index += 1;
  }
  return { positional, flags };
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
}

function rejectUnknownFlags(flags, allowed) {
  for (const flag of flags.keys()) {
    if (!allowed.has(flag)) throw new Error(`Unknown option ${flag}`);
  }
}

function numberFlag(flags, name, fallback, validate) {
  const value = flags.get(name) === undefined ? fallback : Number(flags.get(name));
  if (!validate(value)) throw new Error(`${name} has an invalid numeric value`);
  return value;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run-suite") {
    const { positional, flags } = parseOptions(args);
    rejectUnknownFlags(flags, new Set([
      "--model", "--output", "--resume", "--max-model-requests", "--max-tokens",
      "--temperature", "--top-p", "--seed", "--model-version", "--provider-only",
      "--provider-order", "--no-fallbacks",
      "--stop-after",
    ]));
    if (positional.length !== 1 || !flags.get("--model")) {
      throw new Error("Usage: agentek-gym run-suite <manifest.json> --model <OpenRouter model> [--output <dir>]");
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    const upstreamRpcUrl = process.env.ETHEREUM_RPC_URL;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
    if (!upstreamRpcUrl) throw new Error("ETHEREUM_RPC_URL is required as the Anvil fork source");
    const model = flags.get("--model");
    const maxModelRequests = Number(flags.get("--max-model-requests") ?? 20);
    if (!Number.isSafeInteger(maxModelRequests) || maxModelRequests < 2 || maxModelRequests > 20) {
      throw new Error("--max-model-requests must be between 2 and 20; one turn cannot reliably read then act");
    }
    const maxTokens = numberFlag(flags, "--max-tokens", 1024,
      (value) => Number.isSafeInteger(value) && value >= 1);
    const stopAfter = flags.has("--stop-after")
      ? numberFlag(flags, "--stop-after", 1, (value) => Number.isSafeInteger(value) && value >= 1)
      : undefined;
    const temperature = flags.has("--temperature")
      ? numberFlag(flags, "--temperature", 0, (value) => Number.isFinite(value) && value >= 0 && value <= 2)
      : undefined;
    const topP = flags.has("--top-p")
      ? numberFlag(flags, "--top-p", 1, (value) => Number.isFinite(value) && value >= 0 && value <= 1)
      : undefined;
    const seed = flags.has("--seed")
      ? numberFlag(flags, "--seed", 0, Number.isSafeInteger)
      : undefined;
    const providerRouting = flags.has("--provider-only") || flags.has("--provider-order") || flags.has("--no-fallbacks")
      ? {
          ...(flags.has("--provider-only") ? { only: flags.get("--provider-only").split(",") } : {}),
          ...(flags.has("--provider-order") ? { order: flags.get("--provider-order").split(",") } : {}),
          ...(flags.has("--no-fallbacks") ? { allow_fallbacks: false } : {}),
        }
      : undefined;
    const inferenceSettings = { maxModelRequests, maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(seed === undefined ? {} : { seed }),
      ...(providerRouting === undefined ? {} : { providerRouting }),
    };
    const runConfigurationFingerprint = fingerprintRunConfiguration({
      model, provider: "openrouter", modelVersion: flags.get("--model-version"), inferenceSettings,
    });
    const outputDir = flags.get("--output") ?? join(
      "results",
      safeName(model),
      runConfigurationFingerprint.slice(0, 12),
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8),
    );
    if (flags.get("--resume") && !flags.get("--output")) {
      throw new Error("--resume requires an explicit --output directory");
    }
    const report = await runSuite({
      manifestPath: positional[0],
      outputDir,
      model,
      provider: "openrouter",
      modelVersion: flags.get("--model-version"),
      inferenceSettings,
      upstreamRpcUrl,
      upstreamRpcUrls: {
        ethereum: upstreamRpcUrl,
        base: process.env.BASE_RPC_URL,
        arbitrum: process.env.ARBITRUM_RPC_URL,
        optimism: process.env.OPTIMISM_RPC_URL,
        polygon: process.env.POLYGON_RPC_URL,
      },
      zeroxApiKey: process.env.ZEROX_API_KEY,
      agent: new OpenRouterAgentAdapter({ model, apiKey, maxModelRequests, maxTokens,
        temperature, topP, seed, modelVersion: flags.get("--model-version"), providerRouting }),
      secrets: [apiKey],
      resume: Boolean(flags.get("--resume")),
      stopAfter,
    });
    console.log(`${report.passed}/${report.completed} passed (${report.completed}/${report.total} completed)`);
    console.log(`JSON: ${resolve(outputDir, "report.json")}`);
    console.log(`Markdown: ${resolve(outputDir, "report.md")}`);
    if (report.complete && report.passed !== report.total) process.exitCode = 1;
    return;
  }
  if (command === "compare") {
    const { positional, flags } = parseOptions(args);
    rejectUnknownFlags(flags, new Set(["--output"]));
    if (positional.length < 2) {
      throw new Error("Usage: agentek-gym compare <report1.json> <report2.json> [...] --output <dir>");
    }
    const outputDir = flags.get("--output") ?? join(
      "results",
      "comparisons",
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid,
    );
    const comparison = await compareSavedReports(positional, outputDir);
    console.log(`Compared ${comparison.models.length} runs across ${comparison.tasks.length} tasks`);
    console.log(`JSON: ${resolve(outputDir, "comparison.json")}`);
    console.log(`Markdown: ${resolve(outputDir, "comparison.md")}`);
    return;
  }
  if (command === "reconcile-openrouter") {
    const { positional, flags } = parseOptions(args);
    rejectUnknownFlags(flags, new Set());
    if (positional.length !== 1) {
      throw new Error("Usage: agentek-gym reconcile-openrouter <run-directory>");
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
    const report = await reconcileOpenRouterReport(positional[0], apiKey);
    console.log(`Metadata refreshed for ${report.completed} task(s)`);
    console.log(`Serving providers: ${report.servingProviders.join(", ") || "unknown"}`);
    console.log(`JSON: ${resolve(positional[0], "report.json")}`);
    return;
  }
  throw new Error("Usage: agentek-gym <run-suite|compare|reconcile-openrouter> ...");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
