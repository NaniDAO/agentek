import type { Address, Hex, PublicClient } from "viem";

/**
 * Direct on-chain routing via the zQuoter contract.
 *
 * Replaces zrouter-sdk's `findRoute` + `buildRoutePlan` for building swaps.
 * That path produced a route that cannot execute: for 1,000,000 MOG -> ETH it
 * returned two V4 hops where the second took the *minimum* output of the first
 * as its input (245 USDC units, i.e. $0.000245) while demanding a minimum
 * output of 135,718,476,711,569,800,048 wei (~135.7 ETH). On-chain that reverts
 * with Slippage() (0x7dd37f70), which is exactly what the confirmation sheet
 * was reporting and could not explain.
 *
 * zQuoter does the routing in the contract and hands back ready-to-send
 * calldata, so there is no client-side hop chaining to get wrong. A swap built
 * this way was simulated end-to-end (upgrade + register + approve + swap) and
 * succeeds.
 */

/** Deployed zQuoter per chain. */
export const ZQUOTER_ADDRESS: Record<number, Address> = {
  // Current mainnet deployment. The address the SDK still pins
  // (0x907DAE8d75369A21fFf57402Fe29Ef4e95523465) reverts for pairs this one
  // routes fine, so it is deliberately not used.
  1: "0x0000002d9a651b729e3aFBE57Fc84FFDa4a98a13",
  8453: "0x658bF1A6608210FDE7310760f391AD4eC8006A5F",
};

/** Taken from the contract's own ABI. */
export const zQuoterAbi = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "exactOut", type: "bool" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "swapAmount", type: "uint256" },
      { name: "slippageBps", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    name: "buildBestSwap",
    outputs: [
      {
        components: [
          { name: "source", type: "uint8" },
          { name: "feeBps", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
        ],
        name: "best",
        type: "tuple",
      },
      { name: "callData", type: "bytes" },
      { name: "amountLimit", type: "uint256" },
      { name: "msgValue", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** `zQuoter.AMM` — indices match the contract enum. */
const AMM_NAMES = [
  "UNI_V2", "SUSHI", "UNI_V3", "UNI_V4", "CURVE", "BALANCER", "ZAMM", "MATCHA",
];

export type BuiltSwap = {
  venue: string | null;
  amountIn: bigint;
  amountOut: bigint;
  /** Ready to send to the router; no client-side assembly. */
  callData: Hex;
  /** The bound the CONTRACT derived from slippageBps, surfaced so it can be shown. */
  amountLimit: bigint;
  /** Non-zero only when tokenIn is native ETH. */
  msgValue: bigint;
};

export function zQuoterAddress(chainId: number): Address | null {
  return ZQUOTER_ADDRESS[chainId] ?? null;
}

/**
 * Ask the contract to route and encode the swap.
 *
 * Returns null when the chain has no quoter or the call reverts (no route),
 * so the caller can decide what to say — deliberately not throwing here,
 * because "no route for this pair" is an ordinary answer, not a fault.
 */
export async function buildBestSwap(
  publicClient: PublicClient,
  params: {
    chainId: number;
    to: Address;
    exactOut: boolean;
    tokenIn: Address;
    tokenOut: Address;
    swapAmount: bigint;
    slippageBps: number;
    deadline: bigint;
  }
): Promise<BuiltSwap | null> {
  const quoter = zQuoterAddress(params.chainId);
  if (!quoter) return null;

  try {
    const [best, callData, amountLimit, msgValue] = (await publicClient.readContract({
      address: quoter,
      abi: zQuoterAbi,
      functionName: "buildBestSwap",
      args: [
        params.to,
        params.exactOut,
        params.tokenIn,
        params.tokenOut,
        params.swapAmount,
        BigInt(params.slippageBps),
        params.deadline,
      ],
    })) as unknown as [
      { source: number; feeBps: bigint; amountIn: bigint; amountOut: bigint },
      Hex,
      bigint,
      bigint,
    ];

    if (!callData || callData === "0x") return null;

    return {
      venue: AMM_NAMES[Number(best.source)] ?? null,
      amountIn: best.amountIn,
      amountOut: best.amountOut,
      callData,
      amountLimit,
      msgValue,
    };
  } catch (err) {
    console.warn(
      `[zrouter] zQuoter.buildBestSwap failed on chain ${params.chainId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

/** zRouter's convention for native ETH. */
export const NATIVE_ETH: Address = "0x0000000000000000000000000000000000000000";

export function isNativeETH(token: { address: string; id?: bigint }): boolean {
  return token.address.toLowerCase() === NATIVE_ETH && token.id === undefined;
}
