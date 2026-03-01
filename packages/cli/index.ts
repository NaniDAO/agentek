import { outputError } from "./utils/output.js";
import { createClientFromEnv } from "./utils/client.js";
import { handleList } from "./commands/list.js";
import { handleSearch } from "./commands/search.js";
import { handleInfo } from "./commands/info.js";
import { handleExec } from "./commands/exec.js";
import { handleConfig } from "./commands/config.js";
import { handleSetup } from "./commands/setup.js";
import { handleSigner } from "./commands/signer.js";

const VERSION = "0.0.2";

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

  if (!["list", "info", "exec", "search", "setup", "config", "signer"].includes(command)) {
    printUsage();
  }

  // ── Fast-path commands (no client init) ────────────────────────────────
  if (command === "setup") handleSetup(VERSION);
  if (command === "config") handleConfig(rest);
  if (command === "signer") {
    await handleSigner(rest);
    process.exit(0);
  }

  // ── Client-dependent commands ──────────────────────────────────────────
  const ctx = await createClientFromEnv();

  if (command === "list") handleList(ctx.toolsMap);
  if (command === "search") handleSearch(ctx.toolsMap, rest);
  if (command === "info") handleInfo(ctx.toolsMap, rest);
  if (command === "exec") await handleExec(ctx, rest);
}

main().catch((err) => {
  outputError(err.message || String(err));
});
