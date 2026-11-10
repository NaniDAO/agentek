import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Known keys ──────────────────────────────────────────────────────────────

export interface KnownKey {
  name: string;
  description: string;
}

export const KNOWN_KEYS: KnownKey[] = [
  { name: "AGENTEK_EXECUTION_MODE", description: "prepare (default) or execute: explicitly permit transaction submission" },
  { name: "PRIVATE_KEY", description: "Hex-encoded private key for signing transactions" },
  { name: "ACCOUNT", description: "Hex address to use as the sender (read-only)" },
  { name: "SOLANA_PRIVATE_KEY", description: "Base58 or JSON-array Solana secret key for signing Solana transactions" },
  { name: "SOLANA_ACCOUNT", description: "Base58 Solana address to use as the sender (read-only)" },
  { name: "SOLANA_RPC_URL", description: "Solana JSON-RPC endpoint (defaults to the public mainnet-beta endpoint)" },
  { name: "JUPITER_API_KEY", description: "Jupiter Tokens V2 and Swap V2 tools" },
  { name: "RPC_URLS", description: "EVM JSON-RPC endpoints as a comma-separated chainId=url list (e.g. 1=https://…,8453=https://…)" },
  { name: "ETHEREUM_RPC_URL", description: "Ethereum mainnet JSON-RPC endpoint" },
  { name: "OPTIMISM_RPC_URL", description: "Optimism JSON-RPC endpoint" },
  { name: "ARBITRUM_RPC_URL", description: "Arbitrum One JSON-RPC endpoint" },
  { name: "POLYGON_RPC_URL", description: "Polygon JSON-RPC endpoint" },
  { name: "BASE_RPC_URL", description: "Base JSON-RPC endpoint" },
  { name: "ROBINHOOD_RPC_URL", description: "Robinhood Chain JSON-RPC endpoint" },
  { name: "MODE_RPC_URL", description: "Mode JSON-RPC endpoint" },
  { name: "SEPOLIA_RPC_URL", description: "Sepolia testnet JSON-RPC endpoint" },
  { name: "PERPLEXITY_API_KEY", description: "Perplexity AI search tools" },
  { name: "ZEROX_API_KEY", description: "0x swap/quote tools" },
  { name: "TALLY_API_KEY", description: "Tally governance tools" },
  { name: "COINDESK_API_KEY", description: "CoinDesk news/data tools" },
  { name: "COINMARKETCAL_API_KEY", description: "CoinMarketCal event tools" },
  { name: "FIREWORKS_API_KEY", description: "Fireworks AI tools" },
  { name: "PINATA_JWT", description: "Pinata IPFS tools" },
  { name: "X_BEARER_TOKEN", description: "X/Twitter read tools (Bearer token)" },
  { name: "X_API_KEY", description: "X/Twitter OAuth application key" },
  { name: "X_API_KEY_SECRET", description: "X/Twitter OAuth application secret" },
  { name: "X_ACCESS_TOKEN", description: "X/Twitter OAuth user access token" },
  { name: "X_ACCESS_TOKEN_SECRET", description: "X/Twitter OAuth user access token secret" },
];

const KNOWN_KEY_NAMES = new Set(KNOWN_KEYS.map((k) => k.name));

// ── Config file I/O ─────────────────────────────────────────────────────────

export interface AgentekConfig {
  version: number;
  keys: Record<string, string>;
}

function defaultConfig(): AgentekConfig {
  return { version: 1, keys: Object.create(null) };
}

export function getConfigDir(): string {
  return process.env.AGENTEK_CONFIG_DIR || join(homedir(), ".agentek");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function readConfig(): AgentekConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return defaultConfig();
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!parsed || Array.isArray(parsed) || parsed.version !== 1 ||
        !parsed.keys || typeof parsed.keys !== "object" || Array.isArray(parsed.keys) ||
        Object.values(parsed.keys).some(value => typeof value !== "string")) {
      throw new Error("Expected version 1 and string credential values");
    }
    return { version: 1, keys: Object.assign(Object.create(null), parsed.keys) };
  } catch {
    throw new Error("Invalid Agentek configuration; repair config.json before reading or writing credentials");
  }
}

export function writeConfig(config: AgentekConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const configPath = getConfigPath();
  if (config.version !== 1 || Object.values(config.keys).some(value => typeof value !== "string")) throw new Error("Invalid configuration");
  const temporary = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, configPath);
  } finally { try { unlinkSync(temporary); } catch {} }
}

// ── Key resolution ──────────────────────────────────────────────────────────

export interface ResolvedKey {
  name: string;
  description: string;
  value: string | undefined;
  source: "env" | "config" | undefined;
}

export function resolveAllKeys(): ResolvedKey[] {
  const config = readConfig();
  const generic = new Set([...Object.keys(config.keys), ...Object.keys(process.env)].filter(name => /^RPC_URL_[1-9][0-9]*$/.test(name)));
  return [...KNOWN_KEYS, ...[...generic].sort().map(name => ({name, description: "Per-chain RPC endpoint"}))].map((k) => {
    const envVal = process.env[k.name];
    if (envVal !== undefined && envVal !== "") {
      return { name: k.name, description: k.description, value: envVal, source: "env" as const };
    }
    const cfgVal = config.keys[k.name];
    if (cfgVal !== undefined && cfgVal !== "") {
      return { name: k.name, description: k.description, value: cfgVal, source: "config" as const };
    }
    return { name: k.name, description: k.description, value: undefined, source: undefined };
  });
}

/** Resolve keys into a flat Record suitable for destructuring. */
export function resolveKeys(): Record<string, string | undefined> {
  const resolved = resolveAllKeys();
  const result: Record<string, string | undefined> = {};
  for (const r of resolved) {
    result[r.name] = r.value;
  }
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function isKnownKey(name: string): boolean {
  return KNOWN_KEY_NAMES.has(name) || /^RPC_URL_[1-9][0-9]*$/.test(name);
}

export function redactValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

export function updateConfig(update: (config: AgentekConfig) => void): void {
  const directory = getConfigDir();
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const path = join(directory, "config.lock");
  let lock: number;
  try { lock = openSync(path, "wx", 0o600); }
  catch { throw new Error("Configuration is locked by another writer; retry after that command finishes"); }
  try { const config = readConfig(); update(config); writeConfig(config); }
  finally { closeSync(lock); unlinkSync(path); }
}
