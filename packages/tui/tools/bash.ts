import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const DEBUG_LOG = join(process.cwd(), "debug.log");
function debug(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
}

export async function executeBash(args: { command: string }): Promise<string> {
  debug(`BASH EXEC: ${args.command}`);
  try {
    const output = execSync(args.command, {
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    });
    const result = output.trim() || "(no output)";
    debug(`BASH OK: ${result.slice(0, 500)}`);
    return result;
  } catch (err: any) {
    const stderr = err.stderr?.toString().trim();
    const stdout = err.stdout?.toString().trim();
    const msg = stderr || stdout || err.message;
    const result = `Error (exit ${err.status ?? "?"}): ${msg}`;
    debug(`BASH ERR: ${result.slice(0, 500)}`);
    return result;
  }
}
