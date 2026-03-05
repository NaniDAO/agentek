import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderConfig } from "./provider.js";
import { executeBash } from "./tools/bash.js";
import { executeWriteMarkdown } from "./tools/write-markdown.js";

const DEBUG_LOG = join(process.cwd(), "debug.log");
function debug(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
}

// ── Types ──────────────────────────────────────────────────

export type ApiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ApiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StatsInfo = {
  completionTokens?: number;
  tokPerSec?: string;
  durationMs: number;
};

export type ToolCallInfo = {
  id: string;
  name: string;
  args: unknown;
  completed?: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type AgentEvent =
  | { type: "spinner"; label: string | null }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; name: string; args: unknown; id: string }
  | { type: "tool-result"; name: string; result: string; id: string; durationMs?: number }
  | { type: "tool-error"; name: string; error: string; id: string }
  | { type: "step-boundary" }
  | { type: "finish"; stats: StatsInfo };

// ── Tool definitions (OpenAI format) ──────────────────────

const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Execute a shell command and return the output. Use this to run agentek CLI commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_markdown",
      description: "Write content to a markdown (.md) file in the current directory",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Filename ending in .md (e.g. report.md)" },
          content: { type: "string", description: "Markdown content to write" },
        },
        required: ["filename", "content"],
      },
    },
  },
];

// ── Command safety ────────────────────────────────────────

function classifyBashCommand(command: string): "safe" | "intent" | "blocked" {
  const trimmed = command.trim();

  // Allow agentek read-only commands automatically
  if (/^(npx\s+)?agentek\s+(exec|info|search|list|config|setup)\b/.test(trimmed)) {
    // Check if it's an intent (transaction) command — needs approval
    const execMatch = trimmed.match(/agentek\s+exec\s+(\S+)/);
    if (execMatch && execMatch[1].startsWith("intent")) {
      return "intent";
    }
    return "safe";
  }

  // Block everything else
  return "blocked";
}

// ── Tool executor ─────────────────────────────────────────

/** Normalizes tool names — some models prefix with "default:" or "functions." */
function normalizeName(name: string): string {
  return name.replace(/^(default:|functions\.)/, "");
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const normalized = normalizeName(name);
  switch (normalized) {
    case "bash":
      return executeBash(args as { command: string });
    case "write_markdown":
      return executeWriteMarkdown(args as { filename: string; content: string });
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── System prompt ─────────────────────────────────────────

function buildSystemPrompt(agentekToolList: string): string {
  return `You are Nani Agent, a blockchain AI assistant.

You have ONE tool available: bash. You use it to run agentek CLI commands.
You do NOT have direct access to blockchain tools — everything goes through the agentek CLI via bash.

## How to call tools

All tools are executed through the bash tool using the agentek CLI:
  bash(command="agentek exec <toolName> --param1 value1 --param2 value2")

Other useful agentek commands (also via bash):
  agentek info <toolName>     — show a tool's parameters
  agentek search <keyword>    — find tools by keyword

IMPORTANT: Only run agentek commands via bash. Do NOT run any other shell commands.

## Chain IDs
1=Ethereum, 10=Optimism, 42161=Arbitrum, 137=Polygon, 8453=Base

## Name resolution

- **.eth names** (ENS): resolve first via bash: agentek exec resolveENS --name <name>.eth
- **.wei names** (WNS): resolve first via bash: agentek exec resolveWNS --name <name>.wei
  Also works with bare labels (e.g. "alice" resolves like "alice.wei").
- If unsure whether input is an address or a name, use: agentek exec resolveAnyWNS --input <value>

## Examples

User: "balance of vitalik.eth"
bash(command="agentek exec resolveENS --name vitalik.eth")
→ returns address
bash(command="agentek exec getBalance --address <resolved_address> --chainId 1")
→ returns balance in ETH

User: "balance of shivanshi.wei"
bash(command="agentek exec resolveWNS --name shivanshi.wei")
→ returns address
bash(command="agentek exec getBalance --address <resolved_address> --chainId 1")
→ returns balance in ETH

User: "price of ethereum"
bash(command="agentek exec getCryptoPrice --id ethereum")

User: "latest block on arbitrum"
bash(command="agentek exec getBlockNumber --chainId 42161")

User: "what tokens does 0x1234... hold?"
bash(command="agentek exec getAccountPortfolio --address 0x1234...")

## Available agentek CLI tools (call via bash)
${agentekToolList}

## Rules
- ALWAYS use bash to call agentek exec. NEVER guess or fabricate data.
- If a question involves an ENS name (.eth), resolve it first with resolveENS.
- If a question involves a WNS name (.wei or bare label), resolve it first with resolveWNS.
- If unsure about a tool's parameters, run agentek info <tool> first.
- For transactions (intent* tools), confirm with user before executing.
- Be concise.`;
}

// ── SSE streaming ─────────────────────────────────────────

type StreamResult = {
  content: string;
  toolCalls: ApiToolCall[];
  reasoning: string;
  usage?: { completion_tokens?: number };
};

async function streamChatCompletion(
  config: ProviderConfig,
  messages: ApiMessage[],
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const baseURL = config.provider === "openrouter"
    ? "https://openrouter.ai/api/v1"
    : config.baseURL || "http://localhost:11434/v1";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    tools: TOOL_DEFS,
    stream: true,
    stream_options: { include_usage: true },
  };

  debug(`API REQUEST: ${baseURL}/chat/completions model=${config.model} messages=${messages.length}`);

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    debug(`API ERROR: ${response.status} ${errorText.slice(0, 300)}`);
    throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let inReasoning = false;
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
  let usage: { completion_tokens?: number } | undefined;

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const data = JSON.parse(trimmed.slice(6));

        if (data.usage) usage = data.usage;

        const delta = data.choices?.[0]?.delta;
        if (!delta) continue;

        // Handle reasoning/thinking (varies by provider)
        const reasoningContent = delta.reasoning_content ?? delta.reasoning ?? null;
        if (reasoningContent) {
          if (!inReasoning) {
            inReasoning = true;
            onEvent({ type: "spinner", label: null });
            onEvent({ type: "reasoning-start" });
          }
          reasoning += reasoningContent;
          onEvent({ type: "reasoning-delta", text: reasoningContent });
        }

        // Handle text content
        if (delta.content) {
          if (inReasoning) {
            inReasoning = false;
            onEvent({ type: "reasoning-end" });
          }
          onEvent({ type: "spinner", label: null });
          content += delta.content;
          onEvent({ type: "text-delta", text: delta.content });
        }

        // Handle tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              const id = tc.id || `tool-${idx}`;
              toolCallsMap.set(idx, { id, name: tc.function?.name || "", arguments: "" });
              onEvent({ type: "spinner", label: null });
            }
            const existing = toolCallsMap.get(idx)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
          }
        }
      } catch {
        // Skip unparseable SSE lines
      }
    }
  }

  if (inReasoning) {
    onEvent({ type: "reasoning-end" });
  }

  const toolCalls: ApiToolCall[] = [];
  for (const [, tc] of toolCallsMap) {
    // Normalize the tool name in the parsed result
    tc.name = normalizeName(tc.name);
    toolCalls.push({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    });
  }

  debug(`API RESPONSE: content=${content.length}chars toolCalls=${toolCalls.length} reasoning=${reasoning.length}chars usage=${JSON.stringify(usage)}`);

  return { content, toolCalls, reasoning, usage };
}

// ── Main conversation turn ────────────────────────────────

export type ApprovalRequest = {
  command: string;
  type: "intent" | "blocked";
};

export async function runConversationTurn(
  config: ProviderConfig,
  messages: ApiMessage[],
  onEvent: (event: AgentEvent) => void,
  agentekToolList: string,
  onApprove?: (req: ApprovalRequest) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<ApiMessage[]> {
  const turnStart = Date.now();
  let toolCallTime = 0;
  let totalCompletionTokens = 0;

  const systemMsg: ApiMessage = { role: "system", content: buildSystemPrompt(agentekToolList) };
  const apiMessages: ApiMessage[] = [systemMsg, ...messages];
  const maxSteps = 10;

  onEvent({ type: "spinner", label: "thinking" });

  for (let step = 0; step < maxSteps; step++) {
    if (step > 0) {
      onEvent({ type: "step-boundary" });
      onEvent({ type: "spinner", label: "thinking" });
    }

    if (signal?.aborted) break;
    const result = await streamChatCompletion(config, apiMessages, onEvent, signal);
    if (result.usage?.completion_tokens) {
      totalCompletionTokens += result.usage.completion_tokens;
    }

    // No tool calls — done
    if (result.toolCalls.length === 0) {
      apiMessages.push({ role: "assistant", content: result.content || "" });
      break;
    }

    // Has tool calls — execute them
    apiMessages.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls,
    });

    for (const tc of result.toolCalls) {
      if (signal?.aborted) break;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const toolName = normalizeName(tc.function.name);
      debug(`TOOL CALL: ${toolName} id=${tc.id} args=${JSON.stringify(args)}`);
      onEvent({ type: "tool-call", name: toolName, args, id: tc.id });

      // Safety check for bash commands
      if (toolName === "bash" && typeof args.command === "string") {
        const safety = classifyBashCommand(args.command);

        if (safety !== "safe") {
          // Need approval
          const label = safety === "intent" ? "transaction" : "non-agentek command";
          onEvent({ type: "spinner", label: `awaiting approval (${label})` });

          let approved = false;
          if (onApprove) {
            approved = await onApprove({ command: args.command, type: safety });
          }

          if (!approved) {
            const denial = safety === "intent"
              ? "Transaction was not approved by the user."
              : "Only agentek commands are allowed. This command was blocked.";
            debug(`TOOL BLOCKED: ${toolName} id=${tc.id} reason=${safety}`);
            onEvent({ type: "tool-error", name: toolName, error: denial, id: tc.id });
            apiMessages.push({ role: "tool", tool_call_id: tc.id, content: denial });
            continue;
          }
        }
      }

      onEvent({ type: "spinner", label: `executing ${toolName}` });

      const callStart = Date.now();
      try {
        const toolResult = await executeTool(toolName, args);
        const duration = Date.now() - callStart;
        toolCallTime += duration;

        debug(`TOOL RESULT: ${toolName} id=${tc.id} result=${toolResult.slice(0, 300)}`);
        onEvent({ type: "tool-result", name: toolName, result: toolResult, id: tc.id, durationMs: duration });

        apiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      } catch (err) {
        const duration = Date.now() - callStart;
        toolCallTime += duration;
        const errMsg = err instanceof Error ? err.message : String(err);

        debug(`TOOL ERROR: ${toolName} id=${tc.id} error=${errMsg}`);
        onEvent({ type: "tool-error", name: toolName, error: errMsg, id: tc.id });

        apiMessages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${errMsg}` });
      }
    }
  }

  onEvent({ type: "spinner", label: null });

  const totalMs = Date.now() - turnStart;
  const genMs = totalMs - toolCallTime;
  const tokPerSec = totalCompletionTokens && genMs > 0
    ? (totalCompletionTokens / (genMs / 1000)).toFixed(1)
    : undefined;

  onEvent({
    type: "finish",
    stats: {
      completionTokens: totalCompletionTokens || undefined,
      tokPerSec,
      durationMs: genMs,
    },
  });

  // Return messages without the system prompt
  return apiMessages.slice(1);
}
