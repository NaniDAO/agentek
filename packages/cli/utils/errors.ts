import type { BaseTool } from "@agentek/tools/client";
import { outputError } from "./output.js";
import { levenshtein } from "./levenshtein.js";

/**
 * Map of tool names that are only available when their API key(s) are configured.
 * When an unknown-tool error matches one of these, we surface a MISSING_API_KEY
 * error with a `config set` hint instead of a generic "Unknown tool" message.
 */
export const KEY_GATED_TOOLS: Record<string, string[]> = {
  askPerplexitySearch: ["PERPLEXITY_API_KEY"],
  intent0xSwap: ["ZEROX_API_KEY"],
  tallyProposals: ["TALLY_API_KEY"],
  tallyChains: ["TALLY_API_KEY"],
  tallyUserDaos: ["TALLY_API_KEY"],
  intentGovernorVote: ["TALLY_API_KEY"],
  intentGovernorVoteWithReason: ["TALLY_API_KEY"],
  getLatestCoindeskNewsTool: ["COINDESK_API_KEY"],
  getMarketEvents: ["COINMARKETCAL_API_KEY"],
  generateAndPinImage: ["FIREWORKS_API_KEY", "PINATA_JWT"],
  searchRecentTweets: ["X_BEARER_TOKEN"],
  getTweetById: ["X_BEARER_TOKEN"],
  getXUserByUsername: ["X_BEARER_TOKEN"],
  getXUserTweets: ["X_BEARER_TOKEN"],
  getHomeTimeline: ["X_API_KEY", "X_API_KEY_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
};

/**
 * Detect serialized ZodError JSON in an error message and format it into
 * a human-readable string with a hint to run `agentek info <tool>`.
 */
export function formatZodError(
  errMessage: string,
  toolName: string,
): { message: string; hint: string } | undefined {
  // ZodError.message can be either:
  //   - a JSON array of issues: [{"code":...,"path":...}]
  //   - a JSON object: {"issues":[...],"name":"ZodError"}
  const trimmed = errMessage.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const issues = Array.isArray(parsed)
      ? parsed
      : (parsed?.name === "ZodError" && Array.isArray(parsed?.issues))
        ? parsed.issues
        : null;
    if (!issues || issues.length === 0) return undefined;
    // Verify it looks like Zod issues (must have `code` and `path`)
    if (!issues[0].code || !Array.isArray(issues[0].path)) return undefined;
    const parts = issues.map((issue: Record<string, unknown>) => {
      const path = (issue.path as string[]).join(".") || "unknown";
      const expected = issue.expected ? ` (expected ${issue.expected})` : "";
      if (issue.code === "invalid_type" && issue.received === "undefined") {
        return `Missing required parameter: ${path}${expected}`;
      }
      return `Invalid parameter "${path}": ${issue.message}${expected}`;
    });
    return {
      message: parts.join("; "),
      hint: `Run: agentek info ${toolName}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Detect "not supported" chain errors and append the tool's supported chains.
 */
export function formatChainError(
  errMessage: string,
  tool: BaseTool,
): { message: string; hint: string } | undefined {
  if (!errMessage.toLowerCase().includes("not supported")) return undefined;
  const chains = tool.supportedChains;
  if (!chains || chains.length === 0) return undefined;
  const chainList = chains.map((c) => `${c.name} (${c.id})`).join(", ");
  return {
    message: errMessage,
    hint: `Supported chains: ${chainList}`,
  };
}

/** Find closest tool name match for "did you mean?" suggestions. */
export function suggestTool(input: string, toolsMap: Map<string, BaseTool>): string | undefined {
  const lower = input.toLowerCase();
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name of toolsMap.keys()) {
    // Case-insensitive exact match
    if (name.toLowerCase() === lower) return name;
    // Levenshtein distance for close matches
    const d = levenshtein(lower, name.toLowerCase());
    if (d < bestDist) { bestDist = d; best = name; }
  }
  // Only suggest if reasonably close (max 3 edits or <40% of input length)
  if (best && bestDist <= Math.max(3, Math.floor(input.length * 0.4))) return best;
  return undefined;
}

/** Error with "did you mean?" hint for unknown tool names, or MISSING_API_KEY for key-gated tools. */
export function unknownToolError(toolName: string, toolsMap: Map<string, BaseTool>): never {
  const requiredKeys = KEY_GATED_TOOLS[toolName];
  if (requiredKeys) {
    const keyList = requiredKeys.join(", ");
    const setCommands = requiredKeys.map((k) => `agentek config set ${k} <value>`).join("\n  ");
    outputError(
      `Tool "${toolName}" requires API key${requiredKeys.length > 1 ? "s" : ""}: ${keyList}`,
      {
        code: "MISSING_API_KEY",
        hint: `Configure with:\n  ${setCommands}`,
        retryable: true,
      },
    );
  }
  const suggestion = suggestTool(toolName, toolsMap);
  const hint = suggestion ? `Did you mean "${suggestion}"?` : undefined;
  outputError(`Unknown tool: ${toolName}`, {
    code: "UNKNOWN_TOOL",
    hint,
  });
}
