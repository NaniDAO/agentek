import { embeddedTools, embeddedProfile, credentialOrigins } from "./selected-tools.js";
import { hostCapabilities, installPublicTransport } from "./native-transport.js";
/**
 * WKWebView entry point shared by the iPhone and Mac apps.
 *
 * Loaded into a hidden WKWebView. Swift calls these globals via callAsyncJavaScript().
 * No IPC, no child process, no MCP SDK.
 *
 * Native integration: optional __agentekPublicFetch must pin validated public
 * DNS answers, deny redirects/private ranges, and enforce decoded body/deadline
 * bounds. Without it off-chain NFT metadata is unavailable. agentekCredentials
 * negotiates requestId cancellation and timeoutMs/maximumResponseBytes
 * before returning base64 data; see the root README for the protocol.
 *
 * Exports:
 *   __naniInit(account?, rpcUrlsByChainId?, legacySolana?, enabledCredentials?) -> number (tool count)
 *     - account: 0x address; defaults to zeroAddress
 *     - rpcUrlsByChainId: e.g. { "1": "https://...", "11155111": "https://..." }
 *       Per-chain RPC URLs the user configured in Settings. Falls back to the
 *       shared bounded public RPC fallback when a chain is not present in the map.
 *     - legacySolana: reserved, ignored for compatibility with existing hosts.
 *       Embedded builds omit Solana tools.
 *   __naniList() -> string (JSON array of {name, description, schema})
 *   __naniCall(name, argsJSON) -> Promise<string> (JSON {result} or {error})
 */

import { type Hex, isHex, zeroAddress } from "viem";
import { DEFAULT_CHAINS, resolveTransports } from "../shared/chains/config.js";
import { createAgentekClient, TransactionExecutionError, OperationExecutionError, SolanaExecutionError, type BaseTool } from "../shared/client.js";
import { sanitizeToolOutput } from "../shared/utils/safe-errors.js";
import { toolInputSchema } from "../shared/schema.js";

import { installCredentialTransport } from "../shared/credentialTools/transport.js";
import { safeResearchError } from "../shared/blockscout/research.js";

if ((globalThis as any).webkit?.messageHandlers?.agentekCredentials) {
  installCredentialTransport(request => (globalThis as any).webkit.messageHandlers.agentekCredentials.postMessage(request), hostCapabilities().credentials === 1 ? 1 : 0, credentialOrigins);
}

installPublicTransport();
(globalThis as any).__naniCapabilities = () => ({schemaVersion: 1, publicFetch: hostCapabilities().publicFetch === 1,
  credentialProtocol: hostCapabilities().credentials === 1 ? 1 : 0, solana: false, profile: embeddedProfile === "universal" ? (hostCapabilities().platform === "macos" ? "macos" : "iphone") : embeddedProfile});

const TOOL_TIMEOUT_MS = 120_000;

let toolsMap: Map<string, BaseTool> | null = null;
let agentekClient: ReturnType<typeof createAgentekClient> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Initialize the tool engine. Call once at startup.
 * Returns the number of tools loaded.
 */
(globalThis as any).__naniInit = (
  accountAddress?: string,
  rpcUrlsByChainId?: Record<string, string>,
  _legacySolana?: unknown,
  enabledCredentials: string[] = [],
): number => {
  const chains = DEFAULT_CHAINS;
  const transports = resolveTransports(chains, rpcUrlsByChainId);

  const account = accountAddress && isHex(accountAddress)
    ? accountAddress as Hex
    : zeroAddress;

  const tools = embeddedTools(enabledCredentials, hostCapabilities().platform);

  agentekClient = createAgentekClient({
    executionMode: "prepare",
    transports,
    chains,
    accountOrAddress: account,
    tools,
  });

  toolsMap = agentekClient.getTools() as Map<string, BaseTool>;
  return toolsMap.size;
};

/**
 * List available tools with schemas. Returns JSON string.
 * Schema is a simplified JSON Schema with {properties, required} for ToolFilter.buildSystemPrompt().
 */
(globalThis as any).__naniList = (): string => {
  if (!toolsMap) return "[]";
  const list = Array.from(toolsMap.entries()).map(([name, tool]) => {
    let schema: Record<string, unknown> = {};
    try {
      const full = toolInputSchema(tool.parameters) as Record<string, unknown>;
      schema = { properties: full.properties ?? {}, required: full.required ?? [] };
    } catch {}
    return { name, description: tool.description, schema };
  });
  return JSON.stringify(list);
};

/**
 * Call a tool. Returns a JSON string with {result} or {error}.
 * Swift must call this and handle the returned Promise.
 */
(globalThis as any).__naniCall = async (name: string, argsJSON: string): Promise<string> => {
  if (!toolsMap || !agentekClient) {
    return JSON.stringify({ error: "Not initialized" });
  }

  if (!toolsMap.has(name)) {
    return JSON.stringify({ error: "Unknown tool" });
  }

  try {
    const args = JSON.parse(argsJSON);
    const result = await withTimeout(
      agentekClient.execute(name, args),
      TOOL_TIMEOUT_MS,
      name,
    );
    const safeResult = sanitizeToolOutput(result, agentekClient);
    const text = typeof safeResult === "object" ? JSON.stringify(safeResult) : String(safeResult);
    return JSON.stringify({ result: text });
  } catch (err) {
    const execution = err instanceof TransactionExecutionError || err instanceof SolanaExecutionError ? { retryable: false, execution: err.execution }
      : err instanceof OperationExecutionError ? { retryable: false, completed: err.completed, failedIndex: err.failedIndex, transaction: err.transaction } : {};
    return JSON.stringify(sanitizeToolOutput({ error: "Tool read or action failed", errorInfo: safeResearchError(name, err), ...execution }, agentekClient));
  }
};
