import { createTool } from "../client";
import { z } from "zod";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import {
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseUnits,
  Address,
} from "viem";
import { ACROSS_SPOKE_POOL_ADDRESS, acrossSpokePoolAbi } from "./constants";
import { getAcrossFeeQuote } from "./tools";

const supportedChains = [mainnet, polygon, arbitrum, optimism, base];

function getAcrossSpokePoolAddress(chainId: number): Address {
  const address = ACROSS_SPOKE_POOL_ADDRESS[chainId];
  if (!address) {
    throw new Error(
      `Across SpokePool address not found for chain ID ${chainId}`,
    );
  }
  return address.toLowerCase() as Address;
}

// @TODO Make it work with Ether
export const intentDepositAcross = createTool({
  name: "intentDepositAcross",
  description:
    "Deposits tokens into the Across Protocol bridge to initiate a cross-chain transfer.",
  supportedChains,
  parameters: z.object({
    originChainId: z
      .number()
      .describe("Chain ID of the origin chain for the deposit."),
    originToken: z
      .string()
      .describe("Address of the token to bridge on the origin chain."),
    amount: z.string().describe("Amount of tokens to bridge (in ether)"),
    destinationToken: z
      .string()
      .describe("Address of the token to bridge on the destination chain."),
    destinationChainId: z
      .number()
      .describe("Chain ID of the destination chain for the transfer."),
    recipient: z
      .string()
      .describe("Recipient address on the destination chain."),
  }),
  async execute(client, args) {
    const {
      originChainId,
      originToken,
      destinationToken,
      amount,
      destinationChainId,
      recipient,
    } = args;

    const walletClient = client.getWalletClient(originChainId);
    const publicClient = client.getPublicClient(originChainId);
    const userAddress = await client.getAddress();

    const [tokenSymbol, decimals, currentAllowance] = await Promise.all([
      publicClient.readContract({
        address: originToken as Address,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: originToken as Address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: originToken as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [userAddress, getAcrossSpokePoolAddress(originChainId)],
      }),
    ]);

    const amountBigInt = parseUnits(amount, decimals);
    const spokePoolAddress = getAcrossSpokePoolAddress(originChainId);

    let ops = [];

    if (currentAllowance < amountBigInt) {
      const approvalData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spokePoolAddress, maxUint256],
      });

      ops.push({
        target: originToken as Address,
        value: "0",
        data: approvalData,
      });
    }

    const quote = await getAcrossFeeQuote.execute(client, {
      inputToken: originToken,
      outputToken: destinationToken,
      originChainId,
      destinationChainId,
      amount,
      recipient,
    });

    const outputAmountBigInt = amountBigInt - BigInt(quote.relayFeeTotal);

    // Encode deposit data
    const depositData = encodeFunctionData({
      abi: acrossSpokePoolAbi,
      functionName: "depositV3",
      args: [
        userAddress,
        recipient as Address,
        originToken as Address,
        destinationToken as Address,
        amountBigInt,
        outputAmountBigInt,
        BigInt(destinationChainId),
        quote.exclusiveRelayer as Address,
        Number(quote.timestamp),
        Number(quote.fillDeadline),
        quote.exclusivityDeadline,
        "0x" as Address,
      ],
    });

    ops.push({
      target: spokePoolAddress,
      value: "0",
      data: depositData,
    });

    const destChainName =
      supportedChains.find((chain) => chain.id === destinationChainId)?.name ||
      destinationChainId;

    const intentDescription = `Bridge ${amount} ${tokenSymbol} to ${destChainName} using Across Protocol`;

    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: originChainId,
      };
    } else {
      const hash = await client.executeOps(ops, originChainId);
      return {
        intent: intentDescription,
        ops,
        chain: originChainId,
        hash,
      };
    }
  },
});
