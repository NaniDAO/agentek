import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { Header } from "./components/header.js";
import { Message, SegmentView, type ChatMessage, type StreamSegment } from "./components/message.js";
import { InputBox } from "./components/input-box.js";
import { StatusBar } from "./components/status-bar.js";
import { runConversationTurn, type AgentEvent, type ApprovalRequest, type ApiMessage, type StatsInfo, type ToolCallInfo } from "./agent.js";
import { type ProviderConfig } from "./provider.js";
import { saveProviderModel, saveKey, removeKey, getConfigStatus, getConfigFilePath } from "./config.js";

const COMMANDS: Record<string, string> = {
  "/help":     "Show this help",
  "/provider": "Switch provider — /provider openrouter  or  /provider ollama",
  "/model":    "Switch model — /model google/gemini-2.0-flash-001",
  "/config":   "Show/set config — /config set KEY VALUE, /config unset KEY",
  "/clear":    "Clear conversation history",
  "/quit":     "Exit (also /exit)",
};

type StreamState = {
  segments: StreamSegment[];
  spinner: string | null;
};

type AppProps = {
  initialProviderConfig: ProviderConfig;
  toolCount: number;
  agentekToolList: string;
};

let msgId = 0;
function nextId(): string {
  return String(++msgId);
}

let segId = 0;
function nextSegId(): string {
  return `seg-${++segId}`;
}

export function App({ initialProviderConfig, toolCount, agentekToolList }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ApiMessage[]>([]);
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [commandOutput, setCommandOutput] = useState<string[] | null>(null);
  const [lastStats, setLastStats] = useState<string>("");
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(initialProviderConfig);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalRows, setTerminalRows] = useState(stdout?.rows || 24);

  // Track resize
  useEffect(() => {
    const onResize = () => {
      setTerminalRows(stdout?.rows || 24);
    };
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
  }, [stdout]);

  // Scroll with PageUp/PageDown, Escape to abort
  useInput((_input, key) => {
    if (key.pageUp) {
      setScrollOffset((prev) => prev + 10);
    }
    if (key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - 10));
    }
    if (key.escape && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  });

  const handleCommand = useCallback((text: string) => {
    if (text === "/quit" || text === "/exit") {
      exit();
      return;
    }

    if (text === "/help") {
      setCommandOutput(
        Object.entries(COMMANDS).map(([cmd, desc]) => `${cmd.padEnd(12)} ${desc}`)
      );
      return;
    }

    if (text === "/clear") {
      setChatMessages([]);
      setCompletedMessages([]);
      setCommandOutput(["Conversation cleared."]);
      return;
    }

    if (text === "/config" || text.startsWith("/config ")) {
      const sub = text.slice("/config".length).trim();

      if (sub.startsWith("set ")) {
        const rest = sub.slice("set ".length).trim();
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx === -1) {
          setCommandOutput(["Usage: /config set KEY VALUE"]);
          return;
        }
        const key = rest.slice(0, spaceIdx).toUpperCase();
        const value = rest.slice(spaceIdx + 1).trim();
        if (!value) {
          setCommandOutput(["Usage: /config set KEY VALUE"]);
          return;
        }
        saveKey(key, value);
        setCommandOutput([`Saved ${key} to config. Restart TUI to apply.`]);
        return;
      }

      if (sub.startsWith("unset ")) {
        const key = sub.slice("unset ".length).trim().toUpperCase();
        if (!key) {
          setCommandOutput(["Usage: /config unset KEY"]);
          return;
        }
        removeKey(key);
        setCommandOutput([`Removed ${key} from config.`]);
        return;
      }

      const status = getConfigStatus();
      const lines: string[] = [
        `provider:  ${providerConfig.provider}`,
        `model:     ${providerConfig.model}`,
        ...(providerConfig.baseURL ? [`base URL:  ${providerConfig.baseURL}`] : []),
        `config:    ${getConfigFilePath()}`,
        "",
      ];

      const setKeys = status.filter((s) => s.source !== "not set");
      const unsetKeys = status.filter((s) => s.source === "not set");

      if (setKeys.length > 0) {
        lines.push("Active keys:");
        for (const s of setKeys) {
          const src = s.source === "env" ? "env" : "cfg";
          lines.push(`  ✓ ${s.key.padEnd(26)} [${src}] ${s.masked}`);
        }
        lines.push("");
      }

      if (unsetKeys.length > 0) {
        lines.push("Not set:");
        for (const s of unsetKeys) {
          const note = s.requiredIf ? ` (needed: ${s.requiredIf})` : "";
          lines.push(`  · ${s.key.padEnd(26)} ${s.desc}${note}`);
        }
        lines.push("");
      }

      lines.push("/config set KEY VALUE  —  /config unset KEY");
      setCommandOutput(lines);
      return;
    }

    if (text.startsWith("/provider")) {
      const arg = text.slice("/provider".length).trim();
      if (!arg) {
        setCommandOutput([
          `Current provider: ${providerConfig.provider}`,
          "",
          "Usage: /provider ollama        — local Ollama",
          "       /provider openrouter    — OpenRouter (needs OPENROUTER_API_KEY)",
        ]);
        return;
      }
      if (arg !== "ollama" && arg !== "openrouter") {
        setCommandOutput([`Unknown provider "${arg}". Use: ollama, openrouter`]);
        return;
      }
      const newConfig: ProviderConfig = { ...providerConfig, provider: arg as "ollama" | "openrouter" };
      if (arg === "openrouter") {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          setCommandOutput(["Set OPENROUTER_API_KEY env var first"]);
          return;
        }
        newConfig.apiKey = apiKey;
      } else {
        newConfig.baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      }
      setProviderConfig(newConfig);
      saveProviderModel(newConfig.provider, newConfig.model);
      setCommandOutput([`Switched to ${arg} / ${newConfig.model}`]);
      return;
    }

    if (text.startsWith("/model")) {
      const arg = text.slice("/model".length).trim();
      if (!arg) {
        setCommandOutput([
          `Current model: ${providerConfig.model}`,
          "",
          "Usage: /model <model-id>",
          "  e.g. /model google/gemini-2.0-flash-001",
          "       /model qwen3:1.7b",
        ]);
        return;
      }
      const newConfig = { ...providerConfig, model: arg };
      setProviderConfig(newConfig);
      saveProviderModel(newConfig.provider, newConfig.model);
      setCommandOutput([`Switched to model ${arg} on ${providerConfig.provider}`]);
      return;
    }

    setCommandOutput([`Unknown command: ${text}. Type /help for available commands.`]);
  }, [providerConfig, exit]);

  const handleSubmit = useCallback(async (text: string) => {
    setInput("");
    setCommandOutput(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    // Handle pending approval responses
    if (pendingApproval && approvalResolverRef.current) {
      const answer = trimmed.toLowerCase();
      const approved = answer === "y" || answer === "yes";
      approvalResolverRef.current(approved);
      approvalResolverRef.current = null;
      setPendingApproval(null);
      return;
    }

    if (trimmed.startsWith("/")) {
      handleCommand(trimmed);
      return;
    }

    // Add user message to completed messages
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: trimmed };
    setCompletedMessages((prev) => [...prev, userMsg]);

    const newMessages: ApiMessage[] = [...chatMessages, { role: "user", content: trimmed }];

    // Reset scroll on new content
    setScrollOffset(0);

    const segments: StreamSegment[] = [];
    const toolCallMap = new Map<string, ToolCallInfo>();
    // Track the ID of the last text segment to append deltas to it
    let lastTextSegId: string | null = null;

    const abortController = new AbortController();
    abortRef.current = abortController;

    setStreamState({
      segments: [],
      spinner: "thinking",
    });
    setIsLoading(true);

    let finalStats: StatsInfo | null = null;

    try {
      const updatedMessages = await runConversationTurn(
        providerConfig,
        newMessages,
        (event: AgentEvent) => {
          // Reset scroll on new streaming content
          setScrollOffset(0);

          switch (event.type) {
            case "spinner":
              setStreamState((s) =>
                s ? { ...s, spinner: event.label } : null
              );
              break;

            case "reasoning-start": {
              const id = nextSegId();
              segments.push({ id, kind: "reasoning", content: "" });
              lastTextSegId = null; // New reasoning breaks text continuity
              setStreamState((s) =>
                s ? { ...s, segments: [...segments] } : null
              );
              break;
            }

            case "reasoning-delta": {
              // Update last reasoning segment
              const last = segments[segments.length - 1];
              if (last && last.kind === "reasoning") {
                last.content += event.text;
                setStreamState((s) =>
                  s ? { ...s, segments: [...segments] } : null
                );
              }
              break;
            }

            case "reasoning-end":
              // No-op, reasoning segment stays in place
              break;

            case "text-delta": {
              // Append to last text segment or create new one
              if (lastTextSegId) {
                const seg = segments.find((s) => s.id === lastTextSegId);
                if (seg && seg.kind === "text") {
                  seg.content += event.text;
                  setStreamState((s) =>
                    s ? { ...s, segments: [...segments] } : null
                  );
                  break;
                }
              }
              // Create new text segment
              const id = nextSegId();
              segments.push({ id, kind: "text", content: event.text });
              lastTextSegId = id;
              setStreamState((s) =>
                s ? { ...s, segments: [...segments] } : null
              );
              break;
            }

            case "step-boundary":
              // Do nothing — segments persist across step boundaries
              lastTextSegId = null; // But new text after boundary gets its own segment
              break;

            case "tool-call": {
              let tc = toolCallMap.get(event.id);
              if (tc) {
                tc.args = event.args;
              } else {
                tc = { id: event.id, name: event.name, args: event.args };
                toolCallMap.set(event.id, tc);
                const segmentId = nextSegId();
                segments.push({ id: segmentId, kind: "tool", tc });
              }
              lastTextSegId = null; // Tool breaks text continuity
              setStreamState((s) =>
                s ? { ...s, segments: [...segments] } : null
              );
              break;
            }

            case "tool-result": {
              const tc = toolCallMap.get(event.id);
              if (tc) {
                tc.result = event.result;
                tc.completed = true;
                tc.durationMs = event.durationMs;
              }
              setStreamState((s) =>
                s ? { ...s, segments: [...segments] } : null
              );
              break;
            }

            case "tool-error": {
              const tc = toolCallMap.get(event.id);
              if (tc) {
                tc.error = event.error;
                tc.completed = true;
              }
              setStreamState((s) =>
                s ? { ...s, segments: [...segments] } : null
              );
              break;
            }

            case "finish":
              finalStats = event.stats;
              break;
          }
        },
        agentekToolList,
        async (req) => {
          setPendingApproval(req);
          return new Promise<boolean>((resolve) => {
            approvalResolverRef.current = resolve;
          });
        },
        abortController.signal,
      );

      setChatMessages(updatedMessages);

      // Build final assistant message with segments
      const finalContent = segments
        .filter((s) => s.kind === "text")
        .map((s) => (s as { kind: "text"; content: string }).content)
        .join("");

      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: finalContent,
        segments: [...segments],
        stats: finalStats || undefined,
      };
      setCompletedMessages((prev) => [...prev, assistantMsg]);

      if (finalStats) {
        const s = finalStats;
        const parts: string[] = [];
        if (s.completionTokens) parts.push(`${s.completionTokens} tok`);
        if (s.tokPerSec) parts.push(`${s.tokPerSec} tok/s`);
        parts.push(s.durationMs < 1000 ? `${Math.round(s.durationMs)}ms` : `${(s.durationMs / 1000).toFixed(1)}s`);
        setLastStats(parts.join(" | "));
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (isAbort) {
        // Escape pressed — keep partial segments as a stopped response
        if (segments.length > 0) {
          const partialContent = segments
            .filter((s) => s.kind === "text")
            .map((s) => (s as { kind: "text"; content: string }).content)
            .join("");
          setCompletedMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: partialContent || "(stopped)",
              segments: [...segments],
            },
          ]);
        }
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        setCompletedMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: `Error: ${errMsg}`,
          },
        ]);
      }
    }

    abortRef.current = null;
    setStreamState(null);
    setIsLoading(false);
  }, [chatMessages, providerConfig, handleCommand, agentekToolList, pendingApproval]);

  const statusRight = lastStats || `${providerConfig.provider}/${providerConfig.model}`;

  return (
    <Box flexDirection="column" height={terminalRows}>
      <Header provider={providerConfig.provider} model={providerConfig.model} />

      {/* Scrollable chat area */}
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <Box flexDirection="column" justifyContent="flex-end" flexGrow={1} paddingBottom={scrollOffset}>
          {completedMessages.map((m) => (
            <Message key={m.id} message={m} />
          ))}

          {streamState && streamState.segments.map((seg) => (
            <SegmentView key={seg.id} segment={seg} />
          ))}

          {streamState?.spinner && (
            <Box>
              <Text dimColor>
                {"  "}
                <Spinner type="dots" />
                {" "}
                {streamState.spinner}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {pendingApproval && (
        <Box flexDirection="column">
          <Text color="yellow">  {pendingApproval.type === "intent" ? "⚠ Transaction requires approval:" : "⚠ Non-agentek command requires approval:"}</Text>
          <Text color="white">    {pendingApproval.command}</Text>
          <Text dimColor>  Type y/n and press Enter</Text>
        </Box>
      )}

      {commandOutput && (
        <Box flexDirection="column">
          {commandOutput.map((line, i) => (
            <Text key={i} dimColor color="cyan">  {line}</Text>
          ))}
        </Box>
      )}

      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
      <StatusBar left="/help for commands" right={statusRight} scrollOffset={scrollOffset} />
    </Box>
  );
}
