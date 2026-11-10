# Agentek AI SDK

A toolkit for integrating Agentek blockchain tools with the [Vercel AI SDK](https://sdk.vercel.ai/). This package provides adapters that make Agentek's blockchain tools available as AI function calling tools.

## ✨ Features

- **Vercel AI SDK Integration**: Seamless integration with Vercel's AI SDK
- **Tool Conversion**: Automatically converts Agentek tools to AI SDK compatible format
- **Unified Toolkit**: Bundle multiple tools into a single toolkit
- **Type Safety**: Full TypeScript support with strict typing
- **Compatibility**: Works with OpenRouter, Anthropic, OpenAI, and other LLM providers

## 🚀 Installation

```bash
# npm
npm install @agentek/ai-sdk @agentek/tools

# pnpm
pnpm add @agentek/ai-sdk @agentek/tools

# yarn
yarn add @agentek/ai-sdk @agentek/tools
```

## 📋 Requirements

- Node.js >= 18.17.0 (Required for proper fetch API support)
- `@agentek/tools` as a peer dependency
- Vercel's `ai` package

## 🔧 Usage

### Basic Usage with AI SDK and OpenRouter

```typescript
import { http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelMessage, stepCountIs, generateText } from "ai";
import AgentekToolkit from "@agentek/ai-sdk/toolkit";
import { erc20Tools, rpcTools, swapTools } from "@agentek/tools";
import { ensTools } from "@agentek/tools";

// Set up account
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

// Initialize OpenRouter
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Create the toolkit with your tools
const toolkit = new AgentekToolkit({
  transports: [http()],
  chains: [mainnet],
  accountOrAddress: account,
  tools: [
    ...erc20Tools(),
    ...rpcTools(),
    ...ensTools(),
    // Add more tools as needed
  ],
});

// Get tools in AI SDK format
const tools = toolkit.getTools();

// Set up user query
const messages = [
  {
    role: "user",
    content: "What's the ETH balance of vitalik.eth?",
  },
] as ModelMessage[];

// Generate response with AI using tools
const response = await generateText({
  model: openrouter("anthropic/claude-3-opus"),
  system: `Address: ${account.address}`,
  messages,
  stopWhen: stepCountIs(5), // Maximum number of model steps
  tools: tools,
  activeTools: Object.keys(tools),
});

// Process response
console.log(response.response.messages);
```

### Creating a Toolkit with Various Tool Categories

```typescript
import { http } from "viem";
import { mainnet, base } from "viem/chains";
import AgentekToolkit from "@agentek/ai-sdk/toolkit";
import { erc20Tools, rpcTools, swapTools } from "@agentek/tools";
import { webTools } from "@agentek/tools";
import { naniTools } from "@agentek/tools";
import { fearGreedIndexTools } from "@agentek/tools";

// Create toolkit with multiple transports for different chains
const toolkit = new AgentekToolkit({
  transports: [http(), http()],
  chains: [mainnet, base],
  accountOrAddress: account,
  tools: [
    ...erc20Tools(),
    ...rpcTools(),
    ...webTools(),
    ...naniTools(),
    ...fearGreedIndexTools(),
    // Add API key dependent tools conditionally
    ...swapTools({}), // explicitly unavailable; no credential is required
  ],
});
```

## 🏗️ Implementation Notes

- The toolkit automatically converts Zod parameter schemas into AI SDK tool definitions
- Error handling is built-in with descriptive error messages
- Each tool uses the Agentek client for blockchain interaction

## 📚 Documentation

For more detailed documentation and examples, see the [examples directory](https://github.com/NaniDAO/agentek/tree/main/examples) in the repository.

## 📄 License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)
The examples require AI SDK 6 and `@openrouter/ai-sdk-provider` 2.x. The toolkit defaults to `executionMode: "prepare"`; use `"execute"` explicitly when it should submit transactions. Tool failures throw, and successful values are returned directly.
