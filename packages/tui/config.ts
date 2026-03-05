import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

type KeyInfo = {
  name: string;
  desc: string;
  required?: boolean;
  requiredIf?: string;
};

export const KEY_REGISTRY: KeyInfo[] = [
  // RPC endpoints
  { name: "RPC_ETHEREUM",          desc: "Ethereum mainnet RPC URL",              requiredIf: "ENS, mainnet queries" },
  { name: "RPC_OPTIMISM",          desc: "Optimism RPC URL",                      },
  { name: "RPC_ARBITRUM",          desc: "Arbitrum RPC URL",                      },
  { name: "RPC_POLYGON",           desc: "Polygon RPC URL",                       },
  { name: "RPC_BASE",              desc: "Base RPC URL",                           },
  // Wallet
  { name: "PRIVATE_KEY",           desc: "Wallet private key (tx signing)",       requiredIf: "sending transactions" },
  { name: "ACCOUNT",               desc: "Wallet address (read-only mode)",       requiredIf: "no PRIVATE_KEY" },
  // AI providers
  { name: "OPENROUTER_API_KEY",    desc: "OpenRouter API key",                    requiredIf: "provider=openrouter" },
  // Tool API keys
  { name: "PERPLEXITY_API_KEY",    desc: "Perplexity search",                     },
  { name: "ZEROX_API_KEY",         desc: "0x swap/price quotes",                  },
  { name: "TALLY_API_KEY",         desc: "Tally governance data",                 },
  { name: "COINDESK_API_KEY",      desc: "CoinDesk news/prices",                  },
  { name: "COINMARKETCAL_API_KEY", desc: "CoinMarketCal events",                  },
  { name: "FIREWORKS_API_KEY",     desc: "Fireworks AI (image gen)",              },
  { name: "PINATA_JWT",            desc: "Pinata IPFS pinning",                   },
  { name: "X_BEARER_TOKEN",        desc: "X/Twitter read access",                 },
  { name: "X_API_KEY",             desc: "X/Twitter API key",                     },
  { name: "X_API_KEY_SECRET",      desc: "X/Twitter API key secret",              },
  { name: "X_ACCESS_TOKEN",        desc: "X/Twitter access token",                },
  { name: "X_ACCESS_TOKEN_SECRET", desc: "X/Twitter access token secret",         },
];

export const KNOWN_KEY_NAMES = KEY_REGISTRY.map((k) => k.name);

function getEnvPath(): string {
  const dir = process.env.AGENTEK_CONFIG_DIR || join(homedir(), ".agentek");
  return join(dir, ".env");
}

function readEnvFile(): Record<string, string> {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) return {};
  try {
    const content = readFileSync(envPath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) result[key] = val;
    }
    return result;
  } catch {
    return {};
  }
}

function writeEnvFile(entries: Record<string, string>): void {
  const envPath = getEnvPath();
  try {
    mkdirSync(dirname(envPath), { recursive: true });
    const lines: string[] = ["# Nani Agent config — managed by /config command"];
    for (const [key, val] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      // Quote values that contain spaces or special chars
      const needsQuote = /[\s#"'\\]/.test(val);
      lines.push(`${key}=${needsQuote ? `"${val}"` : val}`);
    }
    writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
  } catch {
    // Silently fail — non-critical
  }
}

/** Read saved provider/model from .env file. Process env vars take precedence. */
export function getSavedProviderModel(): { provider?: string; model?: string } {
  const env = readEnvFile();
  return {
    provider: process.env.NANI_PROVIDER || env.NANI_PROVIDER || undefined,
    model: process.env.NANI_MODEL || env.NANI_MODEL || undefined,
  };
}

/** Persist provider and/or model to ~/.agentek/.env. */
export function saveProviderModel(provider: string, model: string): void {
  const env = readEnvFile();
  env.NANI_PROVIDER = provider;
  env.NANI_MODEL = model;
  writeEnvFile(env);
}

/** Save a single key to ~/.agentek/.env. */
export function saveKey(name: string, value: string): void {
  const env = readEnvFile();
  env[name] = value;
  writeEnvFile(env);
}

/** Remove a key from ~/.agentek/.env. */
export function removeKey(name: string): void {
  const env = readEnvFile();
  delete env[name];
  writeEnvFile(env);
}

export type KeyStatus = {
  key: string;
  desc: string;
  requiredIf?: string;
  source: "env" | "config" | "not set";
  masked: string;
};

/** Get the full config status: each key with its source (env / .env file / not set). */
export function getConfigStatus(): KeyStatus[] {
  const fileEnv = readEnvFile();
  return KEY_REGISTRY.map((info) => {
    const envVal = process.env[info.name];
    if (envVal !== undefined && envVal !== "") {
      return { key: info.name, desc: info.desc, requiredIf: info.requiredIf, source: "env" as const, masked: maskValue(envVal) };
    }
    const cfgVal = fileEnv[info.name];
    if (cfgVal !== undefined && cfgVal !== "") {
      return { key: info.name, desc: info.desc, requiredIf: info.requiredIf, source: "config" as const, masked: maskValue(cfgVal) };
    }
    return { key: info.name, desc: info.desc, requiredIf: info.requiredIf, source: "not set" as const, masked: "" };
  });
}

/** Returns the .env file path for display. */
export function getConfigFilePath(): string {
  return getEnvPath();
}

function maskValue(val: string): string {
  if (val.length <= 8) return "****";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

/** Resolve known keys — process env vars take precedence over ~/.agentek/.env. */
export function resolveKeys(): Record<string, string | undefined> {
  const fileEnv = readEnvFile();
  const result: Record<string, string | undefined> = {};
  for (const name of KNOWN_KEY_NAMES) {
    const envVal = process.env[name];
    if (envVal !== undefined && envVal !== "") {
      result[name] = envVal;
    } else {
      const cfgVal = fileEnv[name];
      result[name] = cfgVal !== undefined && cfgVal !== "" ? cfgVal : undefined;
    }
  }
  return result;
}
