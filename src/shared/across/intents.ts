import { createTool } from "../client";
import { z } from "zod";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";

// -----------------------------------------------------------------------------
// Constants: Across SpokePool Contract ABI and Addresses
// -----------------------------------------------------------------------------

// ABI fragment for the Across SpokePool contract's deposit function.
// This function (depositV3) accepts the following parameters:
//   - token: address of the token to bridge,
//   - amount: uint256 amount to deposit,
//   - destinationChainId: uint256 ID of the destination chain,
//   - recipient: address of the recipient on the destination chain,
//   - message: bytes (optional calldata for additional actions).
const acrossSpokePoolAbi = [
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "destinationChainId", type: "uint256" },
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    name: "depositV3",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

const ACROSS_SPOKE_POOL_ADDRESS: Record<number, string> = {
  [mainnet.id]: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  [polygon.id]: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
  [arbitrum.id]: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a",
  [optimism.id]: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
  [base.id]: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
};

const supportedChains = [mainnet, polygon, arbitrum, optimism, base];

function getAcrossSpokePoolAddress(chainId: number): `0x${string}` {
  const address = ACROSS_SPOKE_POOL_ADDRESS[chainId];
  if (!address) {
    throw new Error(
      `Across SpokePool address not found for chain ID ${chainId}`,
    );
  }
  return address.toLowerCase() as `0x${string}`;
}

// -----------------------------------------------------------------------------
// Intent Tool: Deposit into Across Bridge (On-chain)
// -----------------------------------------------------------------------------

/**
 * intentDepositAcross is an Agentek tool that creates an on-chain deposit transaction
 * to initiate a cross-chain asset transfer via the Across Protocol bridge.
 *
 * It encodes a call to the depositV3 function on the Across SpokePool contract deployed on the origin chain.
 * The intent description is customized to display a human-friendly message.
 *
 * Example intent message:
 *   "Bridge 10 USDC to Base using Across Protocol"
 */
export const intentDepositAcross = createTool({
  name: "intentDepositAcross",
  description:
    "Deposits tokens into the Across Protocol bridge to initiate a cross-chain transfer.",
  supportedChains,
  parameters: z.object({
    originChainId: z
      .number()
      .describe("Chain ID of the origin chain for the deposit."),
    tokenAddress: z
      .string()
      .describe("Address of the token to bridge on the origin chain."),
    amount: z.string().describe("Amount of tokens to deposit."),
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
      tokenAddress,
      amount,
      destinationChainId,
      recipient,
    } = args;

    // Obtain the wallet client for the origin chain.
    const walletClient = client.getWalletClient(originChainId);
    const publicClient = client.getPublicClient(originChainId);

    // Get token details from chain
    const [tokenSymbol, decimals] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ]);

    // Encode the function call data for depositV3.
    const data = encodeFunctionData({
      abi: acrossSpokePoolAbi,
      functionName: "depositV3",
      args: [
        tokenAddress,
        parseUnits(amount, decimals),
        destinationChainId,
        recipient,
        "0x",
      ],
    });

    // Construct the on-chain operation.
    // For ERC-20 token deposits, no native ETH value is needed.
    const ops = [
      {
        target: getAcrossSpokePoolAddress(originChainId),
        value: "0",
        data: data,
      },
    ];

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
