import type { BaseTool, SolanaConfig } from "./client.js";
import type { TwitterToolsConfig } from "./twitter/index.js";

export type OptionalIntegration = "solana" | "x402" | "web" | "twitter";
const supported = new Set<string>(["solana", "x402", "web", "twitter"]);

export function parseIntegrations(value = ""): OptionalIntegration[] {
  const names = [...new Set(value.split(",").map(name => name.trim()).filter(Boolean))];
  for (const name of names) if (!supported.has(name)) throw new Error(`Unknown integration: ${name}. Expected solana, x402, web, or twitter`);
  return names as OptionalIntegration[];
}

/** Node convenience loader. Embedded bundles import individual collections. */
export async function loadIntegrations(names: readonly OptionalIntegration[], config: {solana?: SolanaConfig; twitter?: TwitterToolsConfig} = {}) {
  const tools: BaseTool[] = [];
  let solana: SolanaConfig | undefined;
  for (const name of parseIntegrations(names.join(","))) {
    try {
      switch (name) {
        case "solana": {
          await import("@solana/web3.js");
          const integration = await import("./solana/index.js");
          tools.push(...integration.solanaTools());
          solana = integration.createSolanaConfig(config.solana);
          break;
        }
        case "x402": tools.push(...(await import("./x402/index.js")).x402Tools()); break;
        case "web": {
          const {scrapeWebContent} = await import("./web/tools.js");
          tools.push(scrapeWebContent);
          break;
        }
        case "twitter": tools.push(...await (await import("./twitter/index.js")).twitterTools(config.twitter ?? {})); break;
      }
    } catch (error) {
      const code = (error as {code?: string}).code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        throw new Error(`Integration ${name} requires its optional peer dependencies; see @agentek/tools installation instructions`);
      }
      throw error;
    }
  }
  return {tools, solana};
}
