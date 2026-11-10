import { outputError } from "./utils/output.js";
import { handleConfig } from "./commands/config.js";
import { handleSetup } from "./commands/setup.js";

declare const __AGENTEK_VERSION__: string;
const VERSION = __AGENTEK_VERSION__;

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

  agentek executions                       Review persisted transaction outcomes
  agentek executions acknowledge <id>      Unlock a chain after reconciling an execution

Signer:
  agentek signer init                       Encrypt private key + policy into keyfile
  agentek signer start                      Start signing daemon (prompts for passphrase)
  agentek signer stop                       Stop signing daemon
  agentek signer status                     Show daemon status and address
  agentek signer policy                     Show current policy (prompts for passphrase)
  agentek signer policy set <field> <val>   Update a policy field

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
  When the signer daemon is running, it is preferred over PRIVATE_KEY.
`);
  process.exit(2);
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

  if (!["list", "info", "exec", "search", "setup", "config", "signer", "executions"].includes(command)) {
    printUsage();
  }

  // ── Fast-path commands (no client init) ────────────────────────────────
  if (command === "setup") handleSetup(VERSION);
  if (command === "config") handleConfig(rest);
  if (command === "executions") {
    const { readExecutions, acknowledgeExecution } = await import("@agentek/tools/journal");
    const { getConfigDir } = await import("./config.js");
    const { join } = await import("node:path");
    const { outputJson } = await import("./utils/output.js");
    const directory = join(getConfigDir(), "executions");
    if (!rest.length) outputJson(await readExecutions(directory));
    if (rest.length === 2 && rest[0] === "acknowledge") {
      await acknowledgeExecution(directory, rest[1]);
      outputJson({acknowledged: rest[1]});
    }
    outputError("Usage: agentek executions [acknowledge <id>]. Acknowledge only after reconciling every recorded operation on-chain.");
  }
  if (command === "signer") {
    const { handleSigner } = await import("./commands/signer.js");
    await handleSigner(rest);
    return;
  }

  // ── Client-dependent commands ──────────────────────────────────────────
  const { createClientFromEnv } = await import("./utils/client.js");
  const ctx = await createClientFromEnv();

  if (command === "list") { const { handleList } = await import("./commands/list.js"); await handleList(ctx.toolsMap); }
  if (command === "search") { const { handleSearch } = await import("./commands/search.js"); await handleSearch(ctx.toolsMap, rest); }
  if (command === "info") { const { handleInfo } = await import("./commands/info.js"); await handleInfo(ctx.toolsMap, rest); }
  if (command === "exec") { const { handleExec } = await import("./commands/exec.js"); await handleExec(ctx, rest); }
}

main().catch((err) => {
  outputError(err.message || String(err));
});
