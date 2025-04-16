# Contributing to Agentek

Thank you for your interest in contributing to Agentek! This document provides guidelines and examples for adding new tools to the toolkit.

## Development Setup
1. Clone the repository and navigate to the project directory

```bash
git clone https://github.com/NaniDAO/agentek.git
cd agentek
```

2. Install project dependencies using bun

```bash
bun i
```

3. Configure your environment variables
```bash
cp .env.example .env
```
Open `.env` in your editor and add the required API keys

You're now ready to start developing! You can:
- Run the test suite: `bun test`
- Try the examples
- Start building your own tools or contribute to existing ones

## Tool Interface

Each tool in Agentek follows a standard TypeScript interface enforced with the `createTool` function. Tools require:

- name: A unique identifier string for the tool
- description: A clear description of what the tool does
- parameters: A Zod schema defining the expected arguments
- execute: An async function that performs the tool's operation
- supportedChains: (Optional) Array of viem blockchain network objects the tool supports

### Intent Tools
Intent tools handle blockchain transactions and must follow this pattern:
1. Return an `Intent` object when no wallet is available
2. Execute the transaction when a wallet is available

```typescript
interface Intent {
  intent: string;        // Human readable description of the operation
  ops: Operation[];      // Array of operations to execute
  chain: number;         // Chain ID
  hash?: string;         // Transaction hash (only when executed)
}

interface Operation {
  target: Address;       // Contract address to interact with
  value: string;        // Amount of native token to send
  data: Hex;           // Encoded function call data
}
```

Example Intent Tool Pattern:
```typescript
execute: async (client: AgentekClient, args) => {
  // ... preparation logic ...

  const ops: Operation[] = [
    // Build your operations
  ];

  const intentDescription = `Human readable description of what this does`;

  // If no wallet client, return unexecuted intent
  if (!walletClient) {
    return {
      intent: intentDescription,
      ops,
      chain: chainId,
    };
  }

  // If wallet available, execute and return result with hash
  const hash = await client.executeOps(ops, chainId);
  return {
    intent: intentDescription,
    ops,
    chain: chainId,
    hash,
  };
}
```

## Adding a New Tool

1. Create a new directory in `src/shared/` with your tool name (e.g., `myNewTool`)
2. Implement the Tool interface
3. Export your tool
4. Add it to the tools registry at `src/shared/index.ts`

### Example Tool Implementation

#### Tools

```typescript
export const scrapeWebContent = createTool({
  name: "scrapeWebContent",
  description:
    "Given a URL, fetch the page's HTML and return the main text content as accurately as possible. Works for most websites.",
  parameters: z.object({
    website: z.string(),
  }),
  execute: async (_client, args) => {
    const { website } = args;

    try {
      const response = await fetch(website);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL (status: ${response.status}).`);
      }
      const html = await response.text();

      const $ = cheerio.load(html);

      $("script, style, noscript").remove();

      const textContent = $("body").text() || "";

      const cleanedText = textContent.replace(/\s+/g, " ").trim();

      return {
        website,
        text: cleanedText,
      };
    } catch (error: any) {
      throw new Error(`Error fetching text: ${error.message}`);
    }
  },
});
```

#### Tools requiring API keys

```typescript
export function createAskPerplexitySearchTool(
  perplexityApiKey: string,
): BaseTool {
  return createTool({
    name: "askPerplexitySearch",
    description: "Ask perplexity search",
    supportedChains: [],
    parameters: z.object({
      searchString: z.string(),
    }),
    execute: async (client, args) => {
      const options = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${perplexityApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content: "Be precise and concise.",
            },
            {
              role: "user",
              content: args.searchString,
            },
          ],
          temperature: 0.2,
          top_p: 0.9,
          search_domain_filter: ["perplexity.ai"],
          return_images: false,
          return_related_questions: false,
          search_recency_filter: "month",
          top_k: 0,
          stream: false,
          presence_penalty: 0,
          frequency_penalty: 1,
          response_format: null,
        }),
      };

      try {
        const response = await fetch(
          "https://api.perplexity.ai/chat/completions",
          options,
        );
        const result = await response.json();
        return result;
      } catch (err) {
        throw new Error(`Perplexity API Error: ${err}`);
      }
    },
  });
}
```

#### Intent Tools

```typescript
export const createMatchSwapTool = ({
  zeroxApiKey,
}: {
  zeroxApiKey: string;
}): BaseTool => {
  return createTool({
    name: "intent0xSwap",
    description:
      "Perform a token swap on multiple EVM networks via 0x aggregator (Matcha)",
    // Include all chains you wish to support
    supportedChains: matchaSwapChains,
    parameters: z.object({
      chainId: z.number().describe("Chain ID (e.g. 1, 10, 42161, 8453)"),
      fromToken: z
        .string()
        .describe('Source token address, or "ETH" for native'),
      toToken: z.string().describe("Destination token address"),
      amount: z.number().describe("Amount of source token to swap"),
    }),
    execute: async (client: AgentekClient, args) => {
      const { chainId, fromToken, toToken, amount } = args;

      // Prepare addresses
      const sellToken = normalize(fromToken);
      const buyToken = normalize(toToken);

      // Retrieve the relevant wallet + public clients
      const walletClient = client.getWalletClient(chainId);
      const publicClient = client.getPublicClient(chainId);

      const swapIntentDescription = `Swap ${amount} of ${fromToken} for ${toToken} on chainId ${chainId}`;

      try {
        // Determine decimals
        const sellDecimals =
          sellToken === "ETH"
            ? 18
            : ((await publicClient.readContract({
                address: sellToken as Address,
                abi: erc20Abi,
                functionName: "decimals",
              })) as number) || 18;

        const sellAmount = parseUnits(`${amount}`, sellDecimals);

        const ops = [];
        const userAddress = await client.getAddress();

        // Check user's balance
        const userBalance =
          sellToken === "ETH"
            ? await publicClient.getBalance({ address: userAddress as Address })
            : ((await publicClient.readContract({
                address: sellToken as Address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [userAddress],
              })) as bigint);

        if (userBalance < sellAmount) {
          throw new Error(
            `Insufficient balance: You have ${userBalance.toString()} ${sellToken} but trying to sell ${sellAmount.toString()} ${sellToken}`,
          );
        }

        // Check allowance if we're selling ERC20
        if (sellToken !== "ETH") {
          const EXCHANGE_PROXY = "0xdef1c0ded9bec7f1a1670819833240f027b25eff";
          const currentAllowance = (await publicClient.readContract({
            address: sellToken as Address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [userAddress, EXCHANGE_PROXY],
          })) as bigint;

          if (sellAmount > currentAllowance) {
            ops.push({
              target: sellToken as Address,
              value: "0",
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [EXCHANGE_PROXY, maxUint256],
              }),
            });
          }
        }

        // Fetch quote from 0x
        const zeroXEndpoint = get0xApiEndpoint(chainId);
        const params = new URLSearchParams({
          sellToken,
          buyToken,
          sellAmount: sellAmount.toString(),
          takerAddress: userAddress,
        });

        const quoteUrl = `${zeroXEndpoint}/swap/v1/quote?${params}`;

        const quoteResp = await fetch(quoteUrl, {
          headers: { "0x-api-key": zeroxApiKey },
        });

        if (!quoteResp.ok) {
          throw new Error(
            `Failed to get swap quote: ${quoteResp.status} ${quoteResp.statusText}`,
          );
        }

        const quote = await quoteResp.json();
        if (!quote || quote.code) {
          throw new Error(
            quote.message || "Failed to retrieve a valid swap quote",
          );
        }

        // Build aggregator swap call
        ops.push({
          target: quote.to as Address,
          value: sellToken === "ETH" ? (quote.value as string) : "0",
          data: quote.data as Hex,
        });

        // If no wallet client, return an unexecuted intent
        if (!walletClient) {
          return {
            intent: swapIntentDescription,
            ops,
            chain: chainId,
          };
        }

        // If walletClient is present, execute ops
        const hash = await client.executeOps(ops, chainId);

        return {
          intent: swapIntentDescription,
          ops,
          chain: chainId,
          hash,
        };
      } catch (error) {
        throw new Error(
          `Matcha Swap Failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    },
  });
};
```

### Adding Tool to Registry

1. Export your tools using the collection pattern in your tool directory:

```typescript
// src/shared/myNewTool/index.ts
import { BaseTool, createToolCollection } from "../client.js";
import { myNewTool } from "./tools.js";

export function myNewToolTools(): BaseTool[] {
  return createToolCollection([myNewTool]);
}
```

2. If your tool requires an API key, export a function that accepts config:

```typescript
export function myNewToolTools({ apiKey }: { apiKey: string }): BaseTool[] {
  return createToolCollection([myNewTool(apiKey)]);
}
```

3. Import and add your tools to the registry in `src/shared/index.ts`:

```typescript
import { myNewToolTools } from "./myNewTool.js";

const allTools = ({
  existingApiKey,
  myNewToolApiKey, // Add your API key param if needed
}) => {
  let tools = [
    // ...existingTools
    ...myNewToolTools(), // For tools without API keys
  ];

  if (myNewToolApiKey) {
    tools.push(...myNewToolTools({ apiKey: myNewToolApiKey }));
  }

  return tools;
};
```

4. Update the tool count script at `scripts/tool-count.ts` to include your API key:

```typescript
const tools = allTools({
  ...existingApiKeys,
  myNewToolApiKey: process.env.MY_NEW_TOOL_API_KEY, // Add your API key
});
```

## Code Style
- Always use clear, descriptive and meaningful names. This library is intended to be consumed by AI agents, making this vital.
- Not using any linter or formatter right now but will add that. Expect updates here.

## Testing
- Write unit tests for your tool using Vitest and TypeScript.
- More comprehensive testing will be added in the future.

## Security Guidelines
- Never commit API keys
- Validate all user inputs with Zod schema and further sanitization if required
