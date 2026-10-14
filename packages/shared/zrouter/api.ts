import { type RouteOption, type RouteStep } from "zrouter-sdk";
import { ZROUTER_API_URL } from "./constants.js";
import { byteHex, identityAddress, uint256 } from "../utils/exact.js";
import { readBoundedJSON } from "../utils/fetch.js";

const serializeToken = (token: { address: string; id?: bigint }) => ({ address: token.address, ...(token.id !== undefined ? { id: token.id.toString() } : {}) });
const exact = (v: unknown) => uint256(v);
function token(value: any) {
  return { address: identityAddress.parse(value?.address), ...(value?.id !== undefined ? { id: exact(value.id) } : {}) };
}
/** Provider quantities must be exact strings; missing economics are never zero. */
export function deserializeRoutes(input: unknown): RouteOption[] {
  const routes = (input as any)?.routes;
  if (!Array.isArray(routes) || routes.length > 32) throw new Error("Unreadable or oversized route array");
  return routes.map(route => {
    if (!Array.isArray(route.steps) || !route.steps.length || route.steps.length > 32) throw new Error("Unreadable route steps");
    return { ...route, expectedAmount: exact(route.expectedAmount), steps: route.steps.map((s: any) => {
      if (!["V2", "V3", "V4", "VZ", "MATCHA", "WRAP", "UNWRAP"].includes(s.kind) || !["EXACT_IN", "EXACT_OUT"].includes(s.side)) throw new Error("Unknown route mode or ABI");
      return { ...s, tokenIn: token(s.tokenIn), tokenOut: token(s.tokenOut), amount: exact(s.amount), limit: exact(s.limit),
        deadline: s.deadline === undefined ? undefined : exact(s.deadline), expectedAmount: s.expectedAmount === undefined ? undefined : exact(s.expectedAmount),
        ...(s.to === undefined ? {} : { to: identityAddress.parse(s.to) }), ...(s.router === undefined ? {} : { router: identityAddress.parse(s.router) }),
        ...(s.kind === "VZ" ? { feeOrHook: exact(s.feeOrHook) } : {}),
        ...(s.transaction ? { transaction: { to: identityAddress.parse(s.transaction.to), data: byteHex(s.transaction.data), value: exact(s.transaction.value) } } : {}) };
    }) as RouteStep[] } as RouteOption;
  });
}

export async function fetchApiRoutes(params: { chainId: number; tokenIn: { address: string; id?: bigint }; tokenOut: { address: string; id?: bigint }; side: string; amount: bigint; owner: string; slippageBps?: number }): Promise<RouteOption[] | null> {
  try {
    const response = await fetch(`${ZROUTER_API_URL}/quote`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: params.chainId.toString(), tokenIn: serializeToken(params.tokenIn), tokenOut: serializeToken(params.tokenOut), side: params.side, amount: params.amount.toString(), owner: params.owner, slippageBps: params.slippageBps ?? 50 }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    return deserializeRoutes(await readBoundedJSON(response, 1048576));
  } catch { return null; }
}
