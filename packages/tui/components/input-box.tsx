import React, { useRef, useCallback } from "react";
import { Box, Text, useStdout } from "ink";
import TextInput from "ink-text-input";

type InputBoxProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isLoading: boolean;
};

const PASTE_PLACEHOLDER_RE = /^\[pasted (\d+) lines\]$/;

export function InputBox({ value, onChange, onSubmit, isLoading }: InputBoxProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;
  const borderWidth = width - 2;

  const prevLenRef = useRef(0);
  const pastedContentRef = useRef<string | null>(null);

  const handleChange = useCallback((newValue: string) => {
    const delta = newValue.length - prevLenRef.current;
    prevLenRef.current = newValue.length;

    // Detect paste: large delta with multiple newlines
    if (delta > 1) {
      const newlineCount = (newValue.match(/\n/g) || []).length;
      if (newlineCount > 3) {
        pastedContentRef.current = newValue;
        const placeholder = `[pasted ${newlineCount + 1} lines]`;
        prevLenRef.current = placeholder.length;
        onChange(placeholder);
        return;
      }
    }

    onChange(newValue);
  }, [onChange]);

  const handleSubmit = useCallback((text: string) => {
    // If we have a paste placeholder, expand back to original content
    if (PASTE_PLACEHOLDER_RE.test(text) && pastedContentRef.current) {
      const original = pastedContentRef.current;
      pastedContentRef.current = null;
      prevLenRef.current = 0;
      onSubmit(original);
      return;
    }

    pastedContentRef.current = null;
    prevLenRef.current = 0;
    onSubmit(text);
  }, [onSubmit]);

  return (
    <Box flexDirection="column">
      <Text dimColor>{"╭" + "─".repeat(borderWidth) + "╮"}</Text>
      <Text dimColor>{"│" + " ".repeat(borderWidth) + "│"}</Text>
      <Box>
        <Text dimColor>│  </Text>
        {isLoading ? (
          <Text dimColor>...</Text>
        ) : (
          <Box>
            <Text color="cyan" bold>&gt; </Text>
            <TextInput
              value={value}
              onChange={handleChange}
              onSubmit={handleSubmit}
            />
          </Box>
        )}
      </Box>
      <Text dimColor>{"│" + " ".repeat(borderWidth) + "│"}</Text>
      <Text dimColor>{"╰" + "─".repeat(borderWidth) + "╯"}</Text>
    </Box>
  );
}
