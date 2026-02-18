import { z } from "zod";
import {
  parseUnits,
  maxUint256,
  Address,
  Hex,
  erc20Abi,
  encodeFunctionData,
} from "viem";
import { createTool } from "../client.js";
import type { BaseTool, AgentekClient } from "../client.js";

import { mainnet, optimism, arbitrum, base } from "viem/chains";

/** Native ETH sentinel address used by 0x v2. */
const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Supported chain IDs for 0x Swap API v2. */
const SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set([
  mainnet.id,
  optimism.id,
  arbitrum.id,
  base.id,
]);

/**
 * Helper to handle 'ETH' vs. token addresses.
 * Returns the 0x native token sentinel for ETH, otherwise the address as-is.
 */
function normalize(token: string): string {
  if (!token) return "";
  if (token.toLowerCase() === "eth") return NATIVE_TOKEN;
  return token;
}

const matchaSwapChains = [mainnet, optimism, arbitrum, base];

/**
 * A tool that performs token swaps across multiple networks (Mainnet, Optimism,
 * Arbitrum and Base) via the 0x/Matcha aggregator (v2 AllowanceHolder API).
 *
 * If a wallet client is available, it will execute the swap immediately.
 * If no wallet client is present, it will return a RequestIntent.
 */
export const createMatchSwapTool = ({
  zeroxApiKey,
}: {
  zeroxApiKey: string;
}): BaseTool => {
  return createTool({
    name: "intent0xSwap",
    description:
      "Perform a token swap on multiple EVM networks via 0x aggregator (Matcha)",
    supportedChains: matchaSwapChains,
    parameters: z.object({
      chainId: z.number().describe("Chain ID (e.g. 1, 10, 42161, 8453)"),
      fromToken: z
        .string()
        .describe('Source token address, or "ETH" for native'),
      toToken: z.string().describe("Destination token address"),
      amount: z.number().describe("Amount of source token to swap"),
      slippageBps: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Max slippage in basis points (default 100 = 1%)"),
    }),
    execute: async (client: AgentekClient, args) => {
      const { chainId, fromToken, toToken, amount, slippageBps } = args;

      if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
        throw new Error(
          `Chain ID ${chainId} is not supported by 0x aggregator. Supported: 1, 10, 42161, 8453.`,
        );
      }

      // Prepare addresses
      const sellToken = normalize(fromToken);
      const buyToken = normalize(toToken);
      const isNativeETH = sellToken === NATIVE_TOKEN;

      // Retrieve the relevant wallet + public clients
      const walletClient = client.getWalletClient(chainId);
      const publicClient = client.getPublicClient(chainId);

      const swapIntentDescription = `Swap ${amount} of ${fromToken} for ${toToken} on chainId ${chainId}`;

      try {
        // Determine decimals
        const sellDecimals = isNativeETH
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
        const userBalance = isNativeETH
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

        // Fetch quote from 0x v2 (AllowanceHolder)
        const params = new URLSearchParams({
          chainId: String(chainId),
          sellToken,
          buyToken,
          sellAmount: sellAmount.toString(),
          taker: userAddress,
          slippageBps: String(slippageBps),
        });

        const quoteUrl = `https://api.0x.org/swap/allowance-holder/quote?${params}`;

        const quoteResp = await fetch(quoteUrl, {
          headers: {
            "0x-api-key": zeroxApiKey,
            "0x-version": "v2",
          },
        });

        if (!quoteResp.ok) {
          const errorBody = await quoteResp.text();
          throw new Error(
            `Failed to get swap quote: ${quoteResp.status} ${errorBody}`,
          );
        }

        const quote = await quoteResp.json();
        if (!quote?.transaction) {
          throw new Error(
            quote?.message || "Failed to retrieve a valid swap quote",
          );
        }

        // Check allowance if selling ERC-20 (v2: issues.allowance tells us the spender)
        if (!isNativeETH && quote.issues?.allowance) {
          const spender = quote.issues.allowance.spender as Address;
          const currentAllowance = BigInt(quote.issues.allowance.actual || "0");

          if (sellAmount > currentAllowance) {
            ops.push({
              target: sellToken as Address,
              value: "0",
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [spender, maxUint256],
              }),
            });
          }
        }

        // Build swap call from the v2 nested transaction object
        ops.push({
          target: quote.transaction.to as Address,
          value: (quote.transaction.value as string) || "0",
          data: quote.transaction.data as Hex,
        });

        // If no wallet client, return an unexecuted intent
        if (!walletClient) {
          return {
            intent: swapIntentDescription,
            ops,
            chain: chainId,
            buyAmount: quote.buyAmount,
            minBuyAmount: quote.minBuyAmount,
          };
        }

        // If walletClient is present, execute ops
        const hash = await client.executeOps(ops, chainId);

        return {
          intent: swapIntentDescription,
          ops,
          chain: chainId,
          hash,
          buyAmount: quote.buyAmount,
          minBuyAmount: quote.minBuyAmount,
        };
      } catch (error) {
        throw new Error(
          `Matcha Swap Failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    },
  });
};
