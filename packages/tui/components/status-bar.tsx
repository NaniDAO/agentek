import React from "react";
import { Box, Text, useStdout } from "ink";

type StatusBarProps = {
  left: string;
  right: string;
  scrollOffset?: number;
};

export function StatusBar({ left, right, scrollOffset = 0 }: StatusBarProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  const scrollIndicator = scrollOffset > 0 ? " ↑ scrolled" : "";
  const rightText = right + scrollIndicator;
  const gap = Math.max(1, width - left.length - rightText.length - 1);

  return (
    <Box>
      <Text dimColor> {left}{" ".repeat(gap)}{rightText}</Text>
    </Box>
  );
}
