# agentek

![agentek-logo-1](https://github.com/user-attachments/assets/c73ccd7b-4c4e-4c90-8ccc-1ed101fa1b0b)

An extensible TypeScript toolkit that simplifies complex EVM blockchain interactions into composable, intent-based tools. Provides a unified, type-safe interface for both on-chain actions and off-chain data services, enabling developers to programmatically execute any blockchain operation across multiple EVM networks.

## example tool set

```typescript
// index.ts
import { BaseTool, createToolCollection } from "./client";
import { intentSendEthTool } from "./intents";
import { getEthBalanceTool } from "./tools";

export function helloWorldTools(): BaseTool[] {
  return createToolCollection([
    // tools
    getEthBalanceTool,
    // intents
    intentSendEthTool,
  ]);
}
```

```typescript
// tools.ts
import { z } from "zod";
import { createTool } from "./client";
import { formatEther } from "viem";

const supportedChains = [
  { id: 1, name: "Ethereum" },
  { id: 137, name: "Polygon" },
];

const getEthBalanceParameters = z.object({
  address: z.string().describe("The wallet address to check balance for"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns balance for all supported chains"),
});

export const getEthBalanceTool = createTool({
  name: "getEthBalance",
  description: "Gets the ETH balance of an address",
  supportedChains,
  parameters: getEthBalanceParameters,
  execute: async (client, args) => {
    const { address, chainId } = args;
    const chains = client.filterSupportedChains(supportedChains, chainId);

    const balances = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const balance = await publicClient.getBalance({
            address: address as `0x${string}`,
          });

          return {
            chain: chain.id,
            balance: formatEther(balance),
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch balance: ${error?.shortMessage ?? error?.message}`,
          };
        }
      })
    );

    return balances;
  },
});
```

```typescript
// intents.ts
import { z } from "zod";
import { createTool, Intent } from "./client";
import { parseEther } from "viem";

const supportedChains = [
  { id: 1, name: "Ethereum" },
  { id: 137, name: "Polygon" },
];

const intentSendEthParameters = z.object({
  to: z.string().describe("The recipient address"),
  amount: z.string().describe("The amount of ETH to send"),
  chainId: z.number().describe("The chain to execute on"),
});

export const intentSendEthTool = createTool({
  name: "intentSendEth",
  description: "Creates an intent to send ETH to an address",
  supportedChains,
  parameters: intentSendEthParameters,
  execute: async (client, args): Promise<Intent> => {
    const { to, amount, chainId } = args;
    const from = await client.getAddress();
    const amountWei = parseEther(amount);

    const ops = [
      {
        target: to as `0x${string}`,
        value: amountWei.toString(),
        data: "0x", // Empty calldata for simple ETH transfer
      },
    ];

    const walletClient = client.getWalletClient(chainId);

    if (!walletClient) {
      return {
        intent: `send ${amount} ETH to ${to}`,
        ops,
        chain: chainId,
      };
    } else {
      const hash = await client.executeOps(ops, chainId);
      
      return {
        intent: `Send ${amount} ETH from ${from} to ${to}`,
        ops,
        chain: chainId,
        hash: hash,
      };
    }
  },
});
```
