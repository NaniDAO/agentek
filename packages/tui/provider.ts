import { getSavedProviderModel } from "./config.js";

export interface ProviderConfig {
  provider: "ollama" | "openrouter";
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export function resolveProviderConfig(): ProviderConfig {
  const saved = getSavedProviderModel();
  const provider = (saved.provider || "ollama") as ProviderConfig["provider"];
  const model = saved.model || "qwen3.5:0.8b-nothink";

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error("\x1b[31mOPENROUTER_API_KEY is required when NANI_PROVIDER=openrouter\x1b[0m");
      process.exit(1);
    }
    return { provider, model, apiKey };
  }

  const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
  return { provider, model, baseURL };
}
