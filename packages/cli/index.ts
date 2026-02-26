import { z } from "zod";
import { type Hex, http, isHex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import { allTools } from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";
import { zodToJsonSchema } from "zod-to-json-schema";

const VERSION = "0.1.26";
const TOOL_TIMEOUT_MS = 120_000;

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

/** Print usage text to stderr and exit 2. */
function printUsage(): never {
  process.stderr.write(`agentek v${VERSION} — CLI for Agentek tools

Usage:
  agentek list                              List all available tools
  agentek info <tool-name>                  Show tool description and parameter schema
  agentek exec <tool-name> [--key value]    Execute a tool with the given parameters

Flags:
  --key value       Set a parameter (type-coerced via tool schema)
  --key val --key v Repeated flags become arrays
  --flag            Boolean true (when schema expects boolean)
  --json '{...}'    Merge a JSON object into parameters

Environment:
  PRIVATE_KEY, ACCOUNT, PERPLEXITY_API_KEY, ZEROX_API_KEY,
  TALLY_API_KEY, COINDESK_API_KEY, COINMARKETCAL_API_KEY,
  FIREWORKS_API_KEY, PINATA_JWT, X_BEARER_TOKEN, X_API_KEY,
  X_API_KEY_SECRET
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

    const key = arg.slice(2);

    // --json escape hatch: merge raw JSON into result
    if (key === "json") {
      i++;
      if (i >= argv.length) outputError("--json requires a value");
      try {
        Object.assign(result, JSON.parse(argv[i]));
      } catch {
        outputError(`Invalid JSON for --json: ${argv[i]}`);
      }
      i++;
      continue;
    }

    // Check if next arg exists and is not a flag
    const hasValue = i + 1 < argv.length && !argv[i + 1].startsWith("--");
    const fieldSchema = shape[key];

    if (!hasValue) {
      // Boolean flag (no value)
      result[key] = true;
      i++;
      continue;
    }

    const rawValue = argv[i + 1];
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

    i += 2;
  }

  return result;
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

  if (!["list", "info", "exec"].includes(command)) {
    printUsage();
  }

  // ── Environment ──────────────────────────────────────────────────────
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const ACCOUNT = process.env.ACCOUNT;
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  const ZEROX_API_KEY = process.env.ZEROX_API_KEY;
  const TALLY_API_KEY = process.env.TALLY_API_KEY;
  const COINDESK_API_KEY = process.env.COINDESK_API_KEY;
  const COINMARKETCAL_API_KEY = process.env.COINMARKETCAL_API_KEY;
  const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;
  const PINATA_JWT = process.env.PINATA_JWT;
  const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
  const X_API_KEY = process.env.X_API_KEY;
  const X_API_KEY_SECRET = process.env.X_API_KEY_SECRET;

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
    }),
  });

  const toolsMap = agentekClient.getTools() as Map<string, BaseTool>;

  // ── Commands ─────────────────────────────────────────────────────────

  if (command === "list") {
    const names = Array.from(toolsMap.keys()).sort();
    outputJson(names);
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

    const flags = parseFlags(rest.slice(1), tool!.parameters);

    try {
      const result = await withTimeout(
        agentekClient.execute(toolName, flags),
        TOOL_TIMEOUT_MS,
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
