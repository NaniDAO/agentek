import { z } from "zod";
import { type Hex, http, isHex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import { allTools } from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  KNOWN_KEYS,
  readConfig,
  writeConfig,
  resolveKeys,
  resolveAllKeys,
  redactValue,
  isKnownKey,
} from "./config.js";

const VERSION = "0.1.26";
const DEFAULT_TIMEOUT_MS = 120_000;

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** JSON.stringify replacer that converts BigInt to string. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Write JSON to stdout and exit 0. */
function outputJson(data: unknown): never {
  process.stdout.write(JSON.stringify(data, bigintReplacer, 2) + "\n");
  process.exit(0);
}

/** Write JSON error to stderr and exit 1. */
function outputError(msg: string): never {
  process.stderr.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(1);
}

/** Print version to stdout and exit 0. */
function printVersion(): never {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

/** Print usage text to stderr and exit 2. */
function printUsage(): never {
  process.stderr.write(`agentek v${VERSION} — CLI for Agentek tools

Usage:
  agentek setup                             Show configuration status for all keys
  agentek config set <KEY> <VALUE>          Save a key to ~/.agentek/config.json
  agentek config get <KEY> [--reveal]       Show a key's value (redacted by default)
  agentek config list                       List all known keys with status
  agentek config delete <KEY>               Remove a key from config
  agentek list                              List all available tools
  agentek search <keyword>                  Search tools by name or description
  agentek info <tool-name>                  Show tool description and parameter schema
  agentek exec <tool-name> [--key value]    Execute a tool with the given parameters

Flags:
  --key value       Set a parameter (type-coerced via tool schema)
  --key val --key v Repeated flags become arrays
  --flag            Boolean true (when schema expects boolean)
  --json '{...}'    Merge a JSON object into parameters
  --timeout <ms>    Override the default 120s tool execution timeout
  --version, -v     Print version number

Configuration:
  Keys are stored in ~/.agentek/config.json (override with AGENTEK_CONFIG_DIR).
  Environment variables always take precedence over config file values.
`);
  process.exit(2);
}

/**
 * Parse CLI flags into an object, using the tool's Zod schema for
 * type coercion and array detection.
 */
function parseFlags(argv: string[], schema: z.ZodObject<any>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const shape = schema.shape;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      i++;
      continue;
    }

    // Support both --key value and --key=value
    let key: string;
    let inlineValue: string | undefined;
    const eqIdx = arg.indexOf("=", 2);
    if (eqIdx !== -1) {
      key = arg.slice(2, eqIdx);
      inlineValue = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
    }

    // --json escape hatch: merge raw JSON into result
    if (key === "json") {
      const jsonStr = inlineValue ?? argv[++i];
      if (jsonStr === undefined) outputError("--json requires a value");
      try {
        Object.assign(result, JSON.parse(jsonStr));
      } catch {
        outputError(`Invalid JSON for --json: ${jsonStr}`);
      }
      i++;
      continue;
    }

    const fieldSchema = shape[key];

    // Determine the value: inline (=) takes priority, then next arg
    let rawValue: string | undefined = inlineValue;
    if (rawValue === undefined) {
      const next = argv[i + 1];
      // Next arg is a value if it exists and is not a flag (or schema says number, allowing negatives)
      if (next !== undefined && (!next.startsWith("--") || (fieldSchema && isNumericSchema(fieldSchema) && /^--?\d/.test(next)))) {
        rawValue = next;
        i++; // consume the value arg
      }
    }

    if (rawValue === undefined) {
      // Boolean flag (no value)
      result[key] = true;
      i++;
      continue;
    }

    const coerced = coerceValue(rawValue, fieldSchema);

    // If the schema expects an array, accumulate values
    if (fieldSchema && isArraySchema(fieldSchema)) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(coerced);
      } else {
        result[key] = [coerced];
      }
    } else {
      result[key] = coerced;
    }

    i++;
  }

  return result;
}

/** Check if a Zod schema (possibly wrapped) expects a number. */
function isNumericSchema(schema: z.ZodTypeAny): boolean {
  const inner = unwrapSchema(schema);
  return inner instanceof z.ZodNumber;
}

/** Check if a Zod schema (possibly wrapped in optional/default) is an array type. */
function isArraySchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodOptional) return isArraySchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return isArraySchema(schema.removeDefault());
  return false;
}

/** Unwrap optional/default to get the inner schema. */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) return unwrapSchema(schema.unwrap());
  if (schema instanceof z.ZodDefault) return unwrapSchema(schema.removeDefault());
  return schema;
}

/** Coerce a raw string value based on the Zod schema type. */
function coerceValue(raw: string, schema?: z.ZodTypeAny): unknown {
  if (!schema) return raw;

  let inner = unwrapSchema(schema);

  // For arrays, coerce against the element type
  if (inner instanceof z.ZodArray) {
    inner = inner.element;
  }

  if (inner instanceof z.ZodNumber) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
    return raw;
  }

  if (inner instanceof z.ZodBoolean) {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return raw;
  }

  // ZodEnum, ZodString, etc. — return as-is
  return raw;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
  }

  if (command === "--version" || command === "-v") {
    printVersion();
  }

  if (!["list", "info", "exec", "search", "setup", "config"].includes(command)) {
    printUsage();
  }

  // ── setup (short-circuits before allTools) ─────────────────────────────
  if (command === "setup") {
    const resolved = resolveAllKeys();
    const configured = resolved.filter((r) => r.value !== undefined).length;
    process.stderr.write(`agentek v${VERSION} — configuration status\n\n`);
    for (const r of resolved) {
      const status = r.value
        ? `configured (${r.source})`
        : "missing";
      const symbol = r.value ? "✓" : "✗";
      process.stderr.write(`  ${symbol} ${r.name.padEnd(26)} ${status.padEnd(20)} ${r.description}\n`);
    }
    process.stderr.write(`\n  ${configured}/${resolved.length} keys configured\n`);
    process.exit(0);
  }

  // ── config (short-circuits before allTools) ────────────────────────────
  if (command === "config") {
    const sub = rest[0];

    if (sub === "set") {
      const key = rest[1];
      const value = rest[2];
      if (!key || value === undefined) outputError("Usage: agentek config set <KEY> <VALUE>");
      if (!isKnownKey(key)) {
        process.stderr.write(JSON.stringify({ warning: `${key} is not a known key` }) + "\n");
      }
      const config = readConfig();
      config.keys[key] = value;
      writeConfig(config);
      outputJson({ ok: true, key });
    } else if (sub === "get") {
      const key = rest[1];
      if (!key) outputError("Usage: agentek config get <KEY> [--reveal]");
      const reveal = rest.includes("--reveal");
      const config = readConfig();
      const value = config.keys[key];
      if (value === undefined) {
        outputJson({ key, value: null });
      } else {
        outputJson({ key, value: reveal ? value : redactValue(value) });
      }
    } else if (sub === "list") {
      const resolved = resolveAllKeys();
      outputJson(resolved.map((r) => ({
        key: r.name,
        status: r.value ? "configured" : "missing",
        source: r.source ?? null,
        description: r.description,
      })));
    } else if (sub === "delete") {
      const key = rest[1];
      if (!key) outputError("Usage: agentek config delete <KEY>");
      const config = readConfig();
      const existed = key in config.keys;
      delete config.keys[key];
      writeConfig(config);
      outputJson({ ok: true, key, deleted: existed });
    } else {
      outputError("Usage: agentek config <set|get|list|delete>");
    }

    process.exit(0);
  }

  // ── Environment (env vars override config file) ────────────────────────
  const keys = resolveKeys();
  const PRIVATE_KEY = keys.PRIVATE_KEY;
  const ACCOUNT = keys.ACCOUNT;
  const PERPLEXITY_API_KEY = keys.PERPLEXITY_API_KEY;
  const ZEROX_API_KEY = keys.ZEROX_API_KEY;
  const TALLY_API_KEY = keys.TALLY_API_KEY;
  const COINDESK_API_KEY = keys.COINDESK_API_KEY;
  const COINMARKETCAL_API_KEY = keys.COINMARKETCAL_API_KEY;
  const FIREWORKS_API_KEY = keys.FIREWORKS_API_KEY;
  const PINATA_JWT = keys.PINATA_JWT;
  const X_BEARER_TOKEN = keys.X_BEARER_TOKEN;
  const X_API_KEY = keys.X_API_KEY;
  const X_API_KEY_SECRET = keys.X_API_KEY_SECRET;
  const X_ACCESS_TOKEN = keys.X_ACCESS_TOKEN;
  const X_ACCESS_TOKEN_SECRET = keys.X_ACCESS_TOKEN_SECRET;

  if (PRIVATE_KEY && !isHex(PRIVATE_KEY)) {
    outputError("Invalid PRIVATE_KEY format, must be hex");
  }

  // ── Blockchain setup ─────────────────────────────────────────────────
  const chains = [mainnet, optimism, arbitrum, polygon, base];
  const transports = chains.map(() => http());
  const account = PRIVATE_KEY
    ? privateKeyToAccount(PRIVATE_KEY as Hex)
    : (ACCOUNT && isHex(ACCOUNT) ? ACCOUNT as Hex : zeroAddress);

  // ── Agentek client ───────────────────────────────────────────────────
  const agentekClient = createAgentekClient({
    transports,
    chains,
    accountOrAddress: account,
    tools: await allTools({
      perplexityApiKey: PERPLEXITY_API_KEY,
      zeroxApiKey: ZEROX_API_KEY,
      tallyApiKey: TALLY_API_KEY,
      coindeskApiKey: COINDESK_API_KEY,
      coinMarketCalApiKey: COINMARKETCAL_API_KEY,
      fireworksApiKey: FIREWORKS_API_KEY,
      pinataJWT: PINATA_JWT,
      xBearerToken: X_BEARER_TOKEN,
      xApiKey: X_API_KEY,
      xApiKeySecret: X_API_KEY_SECRET,
      xAccessToken: X_ACCESS_TOKEN,
      xAccessTokenSecret: X_ACCESS_TOKEN_SECRET,
    }),
  });

  const toolsMap = agentekClient.getTools() as Map<string, BaseTool>;

  // ── Commands ─────────────────────────────────────────────────────────

  if (command === "list") {
    const names = Array.from(toolsMap.keys()).sort();
    outputJson(names);
  }

  if (command === "search") {
    const keyword = rest[0];
    if (!keyword) outputError("Usage: agentek search <keyword>");

    const pattern = keyword.toLowerCase();
    const matches: { name: string; description: string }[] = [];
    for (const [name, tool] of toolsMap) {
      if (
        name.toLowerCase().includes(pattern) ||
        tool.description.toLowerCase().includes(pattern)
      ) {
        matches.push({ name, description: tool.description });
      }
    }
    matches.sort((a, b) => a.name.localeCompare(b.name));
    outputJson(matches);
  }

  if (command === "info") {
    const toolName = rest[0];
    if (!toolName) outputError("Usage: agentek info <tool-name>");

    const tool = toolsMap.get(toolName);
    if (!tool) outputError(`Unknown tool: ${toolName}`);

    outputJson({
      name: tool!.name,
      description: tool!.description,
      parameters: zodToJsonSchema(tool!.parameters),
      supportedChains: tool!.supportedChains?.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  if (command === "exec") {
    const toolName = rest[0];
    if (!toolName) outputError("Usage: agentek exec <tool-name> [--key value ...]");

    const tool = toolsMap.get(toolName);
    if (!tool) outputError(`Unknown tool: ${toolName}`);

    // Extract --timeout before parsing tool flags
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    const flagArgs = rest.slice(1);
    const timeoutIdx = flagArgs.indexOf("--timeout");
    if (timeoutIdx !== -1) {
      const raw = flagArgs[timeoutIdx + 1];
      const parsed = Number(raw);
      if (!raw || Number.isNaN(parsed) || parsed <= 0) {
        outputError("--timeout requires a positive number (milliseconds)");
      }
      timeoutMs = parsed;
      flagArgs.splice(timeoutIdx, 2);
    }

    const flags = parseFlags(flagArgs, tool!.parameters);

    try {
      const result = await withTimeout(
        agentekClient.execute(toolName, flags),
        timeoutMs,
        toolName,
      );
      outputJson(result);
    } catch (err: any) {
      outputError(err.message || String(err));
    }
  }
}

main().catch((err) => {
  outputError(err.message || String(err));
});
