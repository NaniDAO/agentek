import { z } from "zod";
import {
  AgentekClient,
  BaseTool,
  createTool,
} from "../client.js";

/**
 * Tool 1 — checkCredits
 * ---------------------
 * Simple data‑fetch tool that returns the user’s total credits,
 * total usage, and current balance in USD.
 */
export const createCheckCreditsTool = (
  openrouterApiKey: string,
): BaseTool =>
  createTool({
    name: "checkCredits",
    description:
      "Return current total credits, total usage, and remaining balance for the configured OpenRouter account.",
    parameters: z.object({}),
    supportedChains: [],
    execute: async (_client: AgentekClient) => {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(
          `OpenRouter /credits request failed: ${res.status} ${res.statusText}`,
        );
      }

      const { data } = (await res.json()) as {
        data: { total_credits: number; total_usage: number };
      };
      const balance = data.total_credits - data.total_usage;

      return {
        total_credits: data.total_credits,
        total_usage: data.total_usage,
        balance,
      };
    },
});
