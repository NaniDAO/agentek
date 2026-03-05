import React from "react";
import { render } from "ink";
import { execSync } from "node:child_process";
import { resolveProviderConfig } from "./provider.js";
import { resolveKeys } from "./config.js";
import { App } from "./app.js";

async function main() {
  // Load ~/.agentek/.env keys into process.env (process env vars take precedence)
  const configKeys = resolveKeys();
  for (const [key, value] of Object.entries(configKeys)) {
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }

  const providerConfig = resolveProviderConfig();

  // Discover available agentek CLI tools with descriptions for the system prompt
  let toolList = "";
  try {
    const raw = execSync("npx agentek search e 2>/dev/null || agentek search e 2>/dev/null", {
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...process.env },
    }).trim();
    const allTools: { name: string; description: string }[] = JSON.parse(raw);
    toolList = allTools.map((t) => {
      const desc = t.description.length > 80 ? t.description.slice(0, 77) + "..." : t.description;
      return `- ${t.name}: ${desc}`;
    }).join("\n");
  } catch {
    try {
      const raw = execSync("npx agentek list 2>/dev/null || agentek list 2>/dev/null", {
        encoding: "utf-8",
        timeout: 15_000,
        env: { ...process.env },
      }).trim();
      toolList = raw;
    } catch {
      toolList = "(could not load tool list — is @agentek/cli installed?)";
    }
  }

  const toolCount = 2; // bash + write_markdown

  // Enter alt screen buffer for fullscreen TUI
  process.stdout.write("\x1b[?1049h");

  const cleanup = () => {
    // Leave alt screen buffer and show cursor
    process.stdout.write("\x1b[?1049l\x1b[?25h");
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const instance = render(
    <App
      initialProviderConfig={providerConfig}
      toolCount={toolCount}
      agentekToolList={toolList}
    />,
  );

  await instance.waitUntilExit();
  cleanup();
}

main().catch((err) => {
  // Restore terminal on error too
  process.stdout.write("\x1b[?1049l\x1b[?25h");
  console.error(`\x1b[31mFatal: ${err.message || err}\x1b[0m`);
  process.exit(1);
});
