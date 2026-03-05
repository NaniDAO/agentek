import React from "react";
import { Box, Text } from "ink";
import type { ToolCallInfo, StatsInfo } from "../agent.js";

// ── Segment types ──────────────────────────────────────────

export type StreamSegment =
  | { id: string; kind: "reasoning"; content: string }
  | { id: string; kind: "text"; content: string }
  | { id: string; kind: "tool"; tc: ToolCallInfo };

// ── Legacy ChatMessage (for completed messages) ────────────

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallInfo[];
  stats?: StatsInfo;
  segments?: StreamSegment[];
};

// ── Helpers ────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  } catch {
    return String(value);
  }
}

function truncateResult(json: string, maxLines = 8): string {
  const lines = json.split("\n");
  if (lines.length <= maxLines) return json;
  return lines.slice(0, maxLines).join("\n") + `\n  ... (${lines.length - maxLines} more lines)`;
}

// ── SegmentView ────────────────────────────────────────────

export function SegmentView({ segment }: { segment: StreamSegment }) {
  if (segment.kind === "reasoning") {
    if (!segment.content) return null;
    return (
      <Box>
        <Text dimColor color="magenta">  [thinking] {segment.content}</Text>
      </Box>
    );
  }

  if (segment.kind === "text") {
    if (!segment.content) return null;
    return <Text>{segment.content}</Text>;
  }

  // segment.kind === "tool"
  const tc = segment.tc;
  return (
    <Box flexDirection="column">
      <Text dimColor color="yellow">  [tool] {tc.name}{tc.args != null && typeof tc.args === "object" && "command" in (tc.args as Record<string, unknown>) ? `: ${(tc.args as Record<string, unknown>).command}` : ""}</Text>
      {tc.completed && !tc.error && (
        <Box flexDirection="column">
          <Text color="green">
            {"  [result] "}
            {tc.name}
            {tc.durationMs !== undefined && <Text dimColor> ({formatDuration(tc.durationMs)})</Text>}
            :
          </Text>
          <Text dimColor>  {tc.result != null ? truncateResult(typeof tc.result === "string" ? tc.result : safeStringify(tc.result)) : "(no output)"}</Text>
        </Box>
      )}
      {tc.error && (
        <Text color="red">  [error] {tc.name}: {tc.error}</Text>
      )}
    </Box>
  );
}

// ── Message (completed messages) ───────────────────────────

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <Box marginTop={1}>
        <Text bold color="cyan">&gt; {message.content}</Text>
      </Box>
    );
  }

  // If the message has segments, render them linearly
  if (message.segments && message.segments.length > 0) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {message.segments.map((seg) => (
          <SegmentView key={seg.id} segment={seg} />
        ))}
        {message.stats && (
          <Box marginTop={1}>
            <Text dimColor>
              {"  "}
              {message.stats.completionTokens && `${message.stats.completionTokens} tok | `}
              {message.stats.tokPerSec && `${message.stats.tokPerSec} tok/s | `}
              {formatDuration(message.stats.durationMs)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Backward compat: render from flat fields
  return (
    <Box flexDirection="column" marginBottom={1}>
      {message.reasoning && (
        <Box>
          <Text dimColor color="magenta">  [thinking] {message.reasoning}</Text>
        </Box>
      )}

      {message.toolCalls?.map((tc) => (
        <Box key={tc.id} flexDirection="column">
          <Text dimColor color="yellow">  [tool] {tc.name}</Text>
          {tc.completed && !tc.error && (
            <Box flexDirection="column">
              <Text color="green">
                {"  [result] "}
                {tc.name}
                {tc.durationMs !== undefined && <Text dimColor> ({formatDuration(tc.durationMs)})</Text>}
                :
              </Text>
              <Text dimColor>  {tc.result != null ? truncateResult(safeStringify(tc.result)) : "(no output)"}</Text>
            </Box>
          )}
          {tc.error && (
            <Text color="red">  [error] {tc.name}: {tc.error}</Text>
          )}
        </Box>
      ))}

      {message.content && <Text>{message.content}</Text>}

      {message.stats && (
        <Box marginTop={1}>
          <Text dimColor>
            {"  "}
            {message.stats.completionTokens && `${message.stats.completionTokens} tok | `}
            {message.stats.tokPerSec && `${message.stats.tokPerSec} tok/s | `}
            {formatDuration(message.stats.durationMs)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
