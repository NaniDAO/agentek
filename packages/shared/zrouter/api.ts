import { type RouteOption, type RouteStep } from "zrouter-sdk";
import { ZROUTER_API_URL } from "./constants.js";

/**
 * Serialize a token for JSON transport (BigInt -> string).
 */
function serializeToken(token: { address: string; id?: bigint }) {
  return {
    ...token,
    id: token.id != null ? token.id.toString() : undefined,
  };
}

/**
 * Deserialize a single route from the API (string -> BigInt).
 */
function deserializeRoute(route: any): RouteOption {
  return {
    ...route,
    expectedAmount: BigInt(route.expectedAmount),
    steps: route.steps.map((step: any) => ({
      ...step,
      amount: step.amount != null ? BigInt(step.amount) : 0n,
      limit: step.limit != null ? BigInt(step.limit) : 0n,
      deadline: step.deadline != null ? BigInt(step.deadline) : 0n,
      expectedAmount: step.expectedAmount != null ? BigInt(step.expectedAmount) : undefined,
      tokenIn: {
        ...step.tokenIn,
        id: step.tokenIn?.id ? BigInt(step.tokenIn.id) : undefined,
      },
      tokenOut: {
        ...step.tokenOut,
        id: step.tokenOut?.id ? BigInt(step.tokenOut.id) : undefined,
      },
      // Preserve Matcha transaction data
      ...(step.transaction
        ? {
            transaction: {
              ...step.transaction,
              value: step.transaction.value != null ? BigInt(step.transaction.value) : 0n,
            },
          }
        : {}),
    })) as RouteStep[],
  };
}

/**
 * Fetch routes from the zrouter-api HTTP service.
 * Returns RouteOption[] sorted best-first, or null on failure.
 */
export async function fetchApiRoutes(params: {
  chainId: number;
  tokenIn: { address: string; id?: bigint };
  tokenOut: { address: string; id?: bigint };
  side: string;
  amount: bigint;
  owner: string;
  slippageBps?: number;
}): Promise<RouteOption[] | null> {
  try {
    const response = await fetch(`${ZROUTER_API_URL}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: params.chainId.toString(),
        tokenIn: serializeToken(params.tokenIn),
        tokenOut: serializeToken(params.tokenOut),
        side: params.side,
        amount: params.amount.toString(),
        owner: params.owner,
        slippageBps: params.slippageBps ?? 50,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.routes || data.routes.length === 0) return null;

    return data.routes.map(deserializeRoute);
  } catch {
    return null;
  }
}
