import { outputJson, outputError } from "../utils/output.js";
import {
  readConfig,
  updateConfig,
  resolveAllKeys,
  redactValue,
  isKnownKey,
} from "../config.js";

export function handleConfig(rest: string[]): void {
  const sub = rest[0];

  if (sub === "set") {
    const key = rest[1];
    const value = rest[2];
    if (!key || value === undefined) outputError("Usage: agentek config set <KEY> <VALUE>");
    if (!isKnownKey(key)) {
      process.stderr.write(JSON.stringify({ warning: `${key} is not a known key` }) + "\n");
    }
    updateConfig(config => { config.keys[key] = value; });
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
    let existed = false;
    updateConfig(config => { existed = key in config.keys; delete config.keys[key]; });
    outputJson({ ok: true, key, deleted: existed });
  } else {
    outputError("Usage: agentek config <set|get|list|delete>");
  }
}
