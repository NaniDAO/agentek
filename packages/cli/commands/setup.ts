import { resolveAllKeys } from "../config.js";

export function handleSetup(version: string): void {
  const resolved = resolveAllKeys();
  const configured = resolved.filter((r) => r.value !== undefined).length;
  process.stderr.write(`agentek v${version} — configuration status\n\n`);
  for (const r of resolved) {
    const status = r.value
      ? `configured (${r.source})`
      : "missing";
    const symbol = r.value ? "\u2713" : "\u2717";
    process.stderr.write(`  ${symbol} ${r.name.padEnd(26)} ${status.padEnd(20)} ${r.description}\n`);
  }
  process.stderr.write(`\n  ${configured}/${resolved.length} keys configured\n`);
  process.exit(0);
}
