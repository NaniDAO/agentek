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

/**
 * Returns the appropriate 0x aggregator endpoint for a given chainId.
 */
function get0xApiEndpoint(chainId: number): string {
  switch (chainId) {
    case mainnet.id:
      return "https://api.0x.org";
    case optimism.id:
      return "https://optimism.api.0x.org";
    case arbitrum.id:
      return "https://arbitrum.api.0x.org";
    case base.id:
      return "https://base.api.0x.org";
    default:
      throw new Error(
        `Chain ID ${chainId} is not supported by 0x aggregator (or endpoint not known).`,
      );
  }
}

/**
 * Helper to handle 'ETH' vs. token addresses.
 */
function normalize(token: string) {
  if (!token) return "";
  if (token.toLowerCase() === "eth") return "ETH";
  return token;
}

const matchaSwapChains = [mainnet, optimism, arbitrum, base];

/**
 * A tool that performs token swaps across multiple networks (Mainnet, Optimism,
 * Arbitrum and Base*) via the 0x/Matcha aggregator.
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
