import React from "react";
import { Box, Text, useStdout } from "ink";

type HeaderProps = {
  provider: string;
  model: string;
};

export function Header({ provider, model }: HeaderProps) {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan"> Nani Agent</Text>
        <Text dimColor> v0.0.1</Text>
        <Text dimColor> — {provider}/{model}</Text>
      </Box>
      <Text dimColor>{"─".repeat(width)}</Text>
    </Box>
  );
}
