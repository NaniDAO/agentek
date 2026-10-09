import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { GymLimitError } from "../harness/ToolHarness.js";
import type { AgentAdapter, AgentContext, AgentRunResult } from "../runner/runEvaluation.js";

interface OpenRouterToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

export interface OpenRouterAgentOptions {
  model: string;
  apiKey: string;
  maxModelRequests?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  seed?: number;
  modelVersion?: string;
  providerRouting?: { only?: string[]; order?: string[]; allow_fallbacks?: boolean };
  endpoint?: string;
  generationEndpoint?: string;
  /** Disable OpenRouter-only generation lookups for a local compatible endpoint. */
  fetchGenerationMetadata?: boolean;
  /** OpenAI-compatible serving endpoints may use this to disable hidden thinking. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

export interface OpenRouterGenerationMetadata {
  providerName?: string;
  model?: string;
  totalCostUsd?: string;
}

// zod-to-json-schema emits an array without `items` for z.array(z.any()).
// Gemini's function-calling endpoint rejects that otherwise valid tool schema.
// This only narrows the model-facing description; Agentek still validates and
// executes the original tool arguments.
const abiParameter = {
  type: "object",
  properties: {
    type: { type: "string" },
    name: { type: "string" },
    stateMutability: { type: "string" },
    inputs: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, type: { type: "string" }, internalType: { type: "string" },
    } } },
    outputs: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, type: { type: "string" }, internalType: { type: "string" },
    } } },
  },
  required: ["type"],
};

function providerToolSchema(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => providerToolSchema(item));
  if (!value || typeof value !== "object") return value;
  const schema = { ...value } as Record<string, unknown>;
  if (schema.type === "array" && schema.items === undefined) {
    schema.items = key === "abi" ? abiParameter : { type: "string" };
  }
  if (schema.properties && typeof schema.properties === "object") {
    schema.properties = Object.fromEntries(Object.entries(schema.properties)
      .map(([name, property]) => [name, providerToolSchema(property, name)]));
  }
  if (schema.items) schema.items = providerToolSchema(schema.items);
  return schema;
}

/** Metadata lookup is read-only and never requests model inference. */
export async function lookupOpenRouterGeneration(
  id: string,
  apiKey: string,
  endpoint = "https://openrouter.ai/api/v1/generation",
  signal?: AbortSignal,
): Promise<OpenRouterGenerationMetadata> {
  const url = new URL(endpoint);
  url.searchParams.set("id", id);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error(`OpenRouter generation metadata HTTP ${response.status}`);
  const body = await response.json() as {
    data?: { provider_name?: string; total_cost?: number | string; model?: string };
  };
  if (!body.data) throw new Error("OpenRouter generation metadata is missing data");
  return {
    providerName: body.data.provider_name,
    model: body.data.model,
    totalCostUsd: body.data.total_cost === undefined ? undefined : String(body.data.total_cost),
  };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reference model adapter. The Gym core remains provider independent. */
export class OpenRouterAgentAdapter implements AgentAdapter {
  constructor(private readonly options: OpenRouterAgentOptions) {
    if (!options.apiKey) throw new Error("OpenRouter API key is required");
    if (!options.model) throw new Error("OpenRouter model ID is required");
    if (options.maxModelRequests !== undefined &&
        (!Number.isSafeInteger(options.maxModelRequests) || options.maxModelRequests < 2 ||
         options.maxModelRequests > 20)) {
      throw new Error("maxModelRequests must be between 2 and 20; one turn cannot reliably read then act");
    }
  }

  async run(context: AgentContext): Promise<AgentRunResult> {
    const tools = context.tools.map((entry) => ({
      type: "function",
      function: {
        name: entry.name,
        description: entry.description,
        parameters: providerToolSchema(zodToJsonSchema(
          entry.parameters as z.ZodTypeAny,
          { target: "openApi3" },
        )),
      },
    }));
    const visibleTools = new Set(context.tools.map((entry) => entry.name));
    const messages: OpenRouterMessage[] = [
      {
        role: "system",
        content:
          `You control a disposable Ethereum Anvil fork through Agentek tools. ` +
          `The evaluation wallet is ${context.walletAddress}. ` +
          "Use the available tools to satisfy the objective. Report the outcome truthfully.",
      },
      { role: "user", content: context.objective },
    ];

    const requestLimit = Math.min(this.options.maxModelRequests ?? 20, context.maxModelRequests ?? 20);
    let output = "";
    let requestsMade = 0;
    while (requestsMade < requestLimit) {
      const completion = await this.completion(messages, tools, context, requestLimit - requestsMade);
      requestsMade += completion.attempts;
      const message = completion.message;
      messages.push(message);
      output = message.content ?? "";
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        if (!output.trim()) {
          throw new Error(`Empty assistant response from ${this.options.model}; no tool call or final answer`);
        }
        return { completed: true, output, modelRequests: requestsMade };
      }
      for (const call of calls) {
        if (!visibleTools.has(call.function.name)) {
          throw new Error(`Model requested unavailable tool ${call.function.name}`);
        }
        let arguments_: unknown;
        try {
          arguments_ = JSON.parse(call.function.arguments);
        } catch {
          throw new Error(`Model supplied invalid JSON for ${call.function.name}`);
        }
        try {
          const result = await context.execute(call.function.name, arguments_);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
          });
        } catch (error) {
          if (error instanceof GymLimitError || context.signal.aborted) throw error;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return { completed: false, output, modelRequests: requestsMade };
  }

  private async completion(
    messages: OpenRouterMessage[],
    tools: unknown[],
    context: AgentContext,
    remainingRequests: number,
  ): Promise<{ message: OpenRouterMessage; attempts: number }> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < Math.min(2, remainingRequests); attempt += 1) {
      context.recordModelRequest?.();
      const response = await fetch(
        this.options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.model,
            messages,
            tools,
            tool_choice: "auto",
            max_tokens: this.options.maxTokens ?? 1024,
            ...(this.options.temperature === undefined ? {} : { temperature: this.options.temperature }),
            ...(this.options.topP === undefined ? {} : { top_p: this.options.topP }),
            ...(this.options.seed === undefined ? {} : { seed: this.options.seed }),
            ...(this.options.reasoningEffort === undefined ? {} :
              { reasoning_effort: this.options.reasoningEffort }),
            ...(this.options.providerRouting === undefined ? {} : { provider: this.options.providerRouting }),
          }),
          signal: context.signal,
        },
      );
      const body = await response.json() as {
        id?: string;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | string };
        error?: { message?: string };
        choices?: { message?: OpenRouterMessage & { reasoning?: string }; finish_reason?: string }[];
      };
      if (response.ok && body.choices?.[0]?.message) {
        let servingProvider: string | undefined;
        let metadataError: string | undefined;
        let metadataCost: string | undefined;
        let resolvedModel = body.model;
        if (body.id && this.options.fetchGenerationMetadata !== false) {
          for (const delay of [0, 500, 1_000, 2_000, 4_000]) {
            try {
              if (delay) await pause(delay, context.signal);
              const metadata = await lookupOpenRouterGeneration(
                body.id, this.options.apiKey, this.options.generationEndpoint, context.signal,
              );
              servingProvider = metadata.providerName;
              metadataCost = metadata.totalCostUsd;
              resolvedModel = metadata.model ?? resolvedModel;
              metadataError = undefined;
              break;
            } catch (error) {
              metadataError = error instanceof Error ? error.message : String(error);
              if (context.signal.aborted || !metadataError.includes("HTTP 404")) break;
            }
          }
        }
        context.recordModelResponse?.({
          generationId: body.id,
          requestedModel: this.options.model,
          resolvedModel,
          servingProvider,
          promptTokens: body.usage?.prompt_tokens,
          completionTokens: body.usage?.completion_tokens,
          finishReason: body.choices[0].finish_reason,
          toolCallCount: body.choices[0].message?.tool_calls?.length ?? 0,
          reasoningCharacters: body.choices[0].message?.reasoning?.length ?? 0,
          costUsd: metadataCost ?? (body.usage?.cost === undefined ? undefined : String(body.usage.cost)),
          metadataError,
        });
        return { message: body.choices[0].message, attempts: attempt + 1 };
      }
      lastError = new Error(
        `OpenRouter HTTP ${response.status}: ${body.error?.message ?? "no assistant message"}`,
      );
      if (attempt === 0 && remainingRequests > 1 &&
          (response.status === 429 || response.status >= 500 ||
           (response.status === 400 && body.error?.message === "Provider returned error"))) {
        continue;
      }
      break;
    }
    throw lastError ?? new Error("OpenRouter request failed");
  }
}
