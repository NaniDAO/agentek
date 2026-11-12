import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("packaged MCP submission boundary", () => {
  it.each(["index.mjs", "index.cjs"])("bounds inputs before SDK validation (%s)", file => {
    const messages = [
      {jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: "2024-11-05",
        capabilities: {}, clientInfo: {name: "resource-fixture", version: "1.0.0"}}},
      {jsonrpc: "2.0", method: "notifications/initialized"},
      ...[2048, 20_000].map((count, index) => ({jsonrpc: "2.0", id: index + 2, method: "tools/call",
        params: {name: "x402Fetch", arguments: {url: "https://paid.example",
          headers: Object.fromEntries(Array.from({length: count}, (_, i) => [String(i), null]))}}})),
    ];
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./dist/${file}`, import.meta.url))], {
      env: {PATH: process.env.PATH, AGENTEK_INTEGRATIONS: "x402"},
      input: messages.map(message => JSON.stringify(message)).join("\n") + "\n",
      encoding: "utf8", timeout: 15_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const responses = child.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    for (const [id, diagnostic] of [[2, "Headers exceed tool input limits"], [3, "maximum of 16384 elements"]] as const) {
      const response = responses.find(message => message.id === id);
      expect(response, child.stdout).toBeDefined();
      expect(response.error ?? response.result?.isError).toBeTruthy();
      expect(JSON.stringify(response)).toContain(diagnostic);
      expect(JSON.stringify(response).length).toBeLessThan(2000);
    }
  });

  it.each(["index.mjs", "index.cjs"])("rejects execute mode before registering tools (%s)", file => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./dist/${file}`, import.meta.url))], {
      env: {PATH: process.env.PATH, AGENTEK_EXECUTION_MODE: "execute", ACCOUNT: `0x${"1".repeat(40)}`},
      input: "", encoding: "utf8", timeout: 15_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("supports prepare mode only");
    expect(child.stderr).not.toContain("tools registered");
  });
});
