import { z } from "zod";
import { AgentekClient, createTool } from "../client";
import { parseUnits, formatUnits, Address, Hex } from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { erc20Abi, maxUint256 } from "viem";

const parameters = z.object({
  tokenIn: z.string().describe("Address of token to swap from"),
  tokenOut: z.string().describe("Address of token to swap to"),
  amount: z.string().describe("Amount to swap in token decimals"),
  slippage: z.number().default(0.5).describe("Maximum slippage percentage"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

const supportedChains = [mainnet, arbitrum, base];

// Chain-specific 0x API endpoints
const ZEROX_API_URLS: Record<number, string> = {
  [mainnet.id]: "https://api.0x.org",
  [arbitrum.id]: "https://arbitrum.api.0x.org",
  [base.id]: "https://base.api.0x.org",
};

const EXCHANGE_PROXIES: Record<number, string> = {
  [mainnet.id]: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  [arbitrum.id]: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  [base.id]: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
};

const filterSupportedChains = (client: AgentekClient, chainId?: number) => {
  let chains = client.getChains();
  chains = chains.filter((chain) =>
    supportedChains.map((c) => c.id).includes(chain.id),
  );
  if (chainId !== undefined) {
    chains = chains.filter((chain) => chain.id === chainId);
    if (chains.length === 0) {
      throw new Error(`Chain ${chainId} is not supported`);
    }
  }
  return chains;
};

async function getQuote(params: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  takerAddress: string;
  slippagePercentage: number;
}) {
  const apiUrl = ZEROX_API_URLS[params.chainId];
  if (!apiUrl) throw new Error(`Unsupported chain ID: ${params.chainId}`);

  const queryParams = new URLSearchParams({
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount.toString(),
    takerAddress: params.takerAddress,
    slippagePercentage: (params.slippagePercentage / 100).toString(),
  });

  const response = await fetch(`${apiUrl}/swap/v1/quote?${queryParams}`, {
    headers: {
      "0x-api-key": process.env.ZEROX_API_KEY || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get quote: ${response.statusText}`);
  }

  return response.json();
}

export const swapTool = createTool({
  name: "swap",
  description: "Swap tokens",
  supportedChains,
  parameters,
  execute: async (client: AgentekClient, args: z.infer<typeof parameters>) => {
    const { chainId, tokenIn, tokenOut, amount, slippage } = args;
    const chains = filterSupportedChains(client, chainId);

    // Get quotes from all supported chains
    const quotePromises = chains.map(async (chain) => {
      try {
        const publicClient = client.getPublicClient(chain.id);
        const address = await client.getAddress();

        // Get token decimals
        const sellDecimals =
          tokenIn.toLowerCase() === "eth"
            ? 18
            : await publicClient.readContract({
                address: tokenIn as Address,
                abi: erc20Abi,
                functionName: "decimals",
              });

        const sellAmount = parseUnits(amount, sellDecimals);

        const quote = await getQuote({
          chainId: chain.id,
          sellToken: tokenIn.toLowerCase() === "eth" ? "ETH" : tokenIn,
          buyToken: tokenOut.toLowerCase() === "eth" ? "ETH" : tokenOut,
          sellAmount,
          takerAddress: address,
          slippagePercentage: slippage,
        });

        return { chain, quote };
      } catch (error) {
        console.error(`Failed to get quote for chain ${chain.id}:`, error);
        return null;
      }
    });

    const quotes = (await Promise.all(quotePromises)).filter(Boolean);
    if (quotes.length === 0) {
      throw new Error("No valid quotes found on any chain");
    }

    // Find the best quote (lowest price impact)
    const optimalQuote = quotes.reduce((best, current) => {
      if (!best) return current;
      return current!.quote.estimatedPriceImpact <
        best.quote.estimatedPriceImpact
        ? current
        : best;
    });

    const optimalChain = optimalQuote!.chain;
    const quote = optimalQuote!.quote;

    const intent = `swap ${amount} ${tokenIn} for ${tokenOut} with ${slippage}% slippage`;
    const ops = [
      {
        target: quote.to as string,
        value:
          tokenIn.toLowerCase() === "eth"
            ? BigInt(quote.value || 0)
            : BigInt(0),
        data: quote.data as Hex,
      },
    ];

    // If approval is needed, add approval operation
    if (tokenIn.toLowerCase() !== "eth") {
      const publicClient = client.getPublicClient(optimalChain);
      const exchangeProxy = EXCHANGE_PROXIES[optimalChain.id];

      const currentAllowance = await publicClient.readContract({
        address: tokenIn as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [await client.getAddress(), exchangeProxy as Address],
      });

      if (BigInt(quote.sellAmount) > currentAllowance) {
        ops.unshift({
          target: tokenIn,
          value: BigInt(0),
          data: (
            await publicClient.simulateContract({
              address: tokenIn as Address,
              abi: erc20Abi,
              functionName: "approve",
              args: [exchangeProxy as Address, maxUint256],
            })
          ).request.data as Hex,
        });
      }
    }

    const walletClient = client.getWalletClient(optimalChain.id);
    if (!walletClient) {
      return {
        intent,
        ops,
        chain: optimalChain.id,
      };
    }

    // Execute the transaction(s)
    const receipts = [];
    for (const op of ops) {
      const hash = await walletClient.sendTransaction({
        to: op.target as Address,
        value: op.value,
        data: op.data,
      });

      const receipt = await client
        .getPublicClient(optimalChain.id)
        .waitForTransactionReceipt({ hash });
      receipts.push(receipt);
    }

    return {
      intent,
      calls: ops,
      chain: optimalChain.id,
      receipt: receipts[receipts.length - 1], // Return the swap receipt
    };
  },
});
