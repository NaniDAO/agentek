import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { Address, Hex, encodeFunctionData, maxUint256 } from "viem";
import { mainnet, base } from "viem/chains";
import {
  buildRoutePlan,
  checkRouteApprovals,
  erc20Abi,
  erc6909Abi,
  findRoute,
  getConfig,
  zRouterAbi,
  type RouteStep,
} from "zrouter-sdk";
import { supportedChains } from './constants.js';
import { AmountSchema, SymbolOrTokenSchema } from "./types.js";
import { addressSchema } from "../utils.js";
import { asToken, resolveInputToToken, toBaseUnits } from "./utils.js";
import { fetchApiRoutes } from "./api.js";

const swapParameters = z.object({
  chainId: z.number().default(1).describe("Chain ID (1 for Mainnet, 8453 for Base). Default: 1"),
  tokenIn: SymbolOrTokenSchema.describe(`Symbol (e.g. "USDT") or { address, id? }`),
  tokenOut: SymbolOrTokenSchema.describe(`Symbol (e.g. "IZO") or { address, id? }`),
  amount: AmountSchema.describe("Human-readable amount, e.g. 1.5"),
  side: z.enum(["EXACT_IN", "EXACT_OUT"]),
  slippageBps: z.number().int().min(0).max(10_000).default(50).describe("Basis points, default 50 = 0.50%"),
  deadlineSeconds: z.number().int().positive().default(300).describe("From now, default 300s"),
  owner: addressSchema.optional(),
  finalTo: addressSchema.optional(),
  router: addressSchema.optional(),
});

export const intentSwap = createTool({
  name: "swap",
  description: "Swap ERC20 and ERC6909 tokens (proper approvals then router call).",
  supportedChains,
  parameters: swapParameters,
  execute: async (client: AgentekClient, args: z.infer<typeof swapParameters>): Promise<Intent> => {
    const chainId = args.chainId as 1 | 8453;
    if (chainId !== mainnet.id && chainId !== base.id) {
      throw new Error(`Unsupported chain ID ${chainId}. Supported: 1 (Mainnet), 8453 (Base).`);
    }
    const walletClient = client.getWalletClient(chainId);
    const publicClient = client.getPublicClient(chainId);

    const owner: Address =
      args.owner ??
      (walletClient?.account?.address as Address) ??
      (() => {
        throw new Error("Owner address is required (connect a wallet or pass 'owner').");
      })();

    const finalTo: Address = args.finalTo ?? owner;

    // Resolve tokens
    const [tIn, tOut] = await Promise.all([
      resolveInputToToken(args.tokenIn, chainId),
      resolveInputToToken(args.tokenOut, chainId),
    ]);

    // Parse human amount -> base units (by side)
    const humanAmount = typeof args.amount === "number" ? String(args.amount) : args.amount;
    const baseAmount =
      args.side === "EXACT_IN" ? toBaseUnits(humanAmount, tIn) : toBaseUnits(humanAmount, tOut);

    // Deadline/slippage
    const deadline = BigInt(Math.floor(Date.now() / 1000) + args.deadlineSeconds);

    // --- Try API first for routes (includes Matcha/0x aggregated quotes) ---
    let steps: RouteStep[] | null = null;
    const apiRoutes = await fetchApiRoutes({
      chainId,
      tokenIn: asToken(tIn),
      tokenOut: asToken(tOut),
      side: args.side,
      amount: baseAmount,
      owner,
      slippageBps: args.slippageBps,
    });

    if (apiRoutes && apiRoutes.length > 0) {
      steps = apiRoutes[0].steps;
    }

    // --- Fallback to SDK findRoute if API didn't return routes ---
    if (!steps) {
      const sdkSteps = await findRoute(publicClient, {
        tokenIn: asToken(tIn),
        tokenOut: asToken(tOut),
        side: args.side as any,
        amount: baseAmount,
        deadline,
        owner,
        slippageBps: args.slippageBps,
      } as any);

      if (!sdkSteps?.length) throw new Error("No route found for the requested swap.");
      steps = sdkSteps;
    }

    const router: Address =
      args.router ??
      (steps[0] as any)?.router ??
      getConfig(chainId).router;

    // --- Check if the best route is a direct Matcha swap ---
    // Matcha routes have a single MATCHA step with a raw 0x transaction
    // that should be executed directly (not through zRouter multicall)
    const isMatchaRoute = steps.length === 1 && steps[0].kind === "MATCHA";

    if (isMatchaRoute) {
      const matchaStep = steps[0] as Extract<RouteStep, { kind: "MATCHA" }>;
      const tx = matchaStep.transaction;

      // Build approval ops for the Matcha allowance target
      const approvalOps: { target: Address; value: string; data: Hex }[] = [];
      const allowanceTarget = matchaStep.metadata?.allowanceTarget;
      if (allowanceTarget) {
        const approvalData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [allowanceTarget, maxUint256],
        });
        approvalOps.push({
          target: matchaStep.tokenIn.address as Address,
          value: "0",
          data: approvalData,
        });
      }

      // The raw 0x swap transaction
      const swapOp = {
        target: tx.to,
        value: tx.value.toString(),
        data: tx.data,
      };

      const ops = [...approvalOps, swapOp];

      const pretty = `${args.side === "EXACT_IN" ? "Swap" : "Receive"} ${humanAmount} ${
        typeof args.tokenIn === "string" ? args.tokenIn.toUpperCase() : tIn.symbol ?? "TOKEN"
      } → ${typeof args.tokenOut === "string" ? args.tokenOut.toUpperCase() : tOut.symbol ?? "TOKEN"} (via Matcha)`;

      if (!walletClient) {
        return { intent: pretty, ops, chain: chainId };
      }

      const hash = await client.executeOps(ops, chainId);
      return { intent: pretty, ops, chain: chainId, hash };
    }

    // --- Standard zRouter path: check approvals, build plan, multicall ---

    // Use checkRouteApprovals() instead of plan.approvals (empty in SDK >= 0.0.27)
    const approvals = await checkRouteApprovals(publicClient, {
      owner,
      router,
      steps,
    });

    const plan = await buildRoutePlan(publicClient, {
      owner,
      router,
      steps,
      finalTo,
    });

    // Build approval ops from checkRouteApprovals result
    const approvalOps = approvals.map((appr) => {
      if (appr.kind === "ERC20_APPROVAL") {
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [appr.spender as Address, maxUint256],
        });
        return {
          target: appr.token.address as Address,
          value: "0",
          data: data as Hex,
        };
      }

      if (appr.kind === "ERC6909_SET_OPERATOR") {
        const data = encodeFunctionData({
          abi: erc6909Abi,
          functionName: "setOperator",
          args: [appr.operator as Address, true],
        });
        return {
          target: appr.token.address as Address,
          value: "0",
          data: data as Hex,
        };
      }

      throw new Error(`Unsupported approval action: ${String((appr as any).kind)}`);
    });

    // Router call: single call or multicall
    const routerCallOp =
      plan.calls.length === 1
        ? {
            target: router,
            value: plan.value.toString(),
            data: plan.calls[0] as Hex,
          }
        : {
            target: router,
            value: plan.value.toString(),
            data: encodeFunctionData({
              abi: zRouterAbi,
              functionName: "multicall",
              args: [plan.calls as Hex[]],
            }),
          };

    const ops = [...approvalOps, routerCallOp];

    const pretty = `${args.side === "EXACT_IN" ? "Swap" : "Receive"} ${humanAmount} ${
      typeof args.tokenIn === "string" ? args.tokenIn.toUpperCase() : tIn.symbol ?? "TOKEN"
    } → ${typeof args.tokenOut === "string" ? args.tokenOut.toUpperCase() : tOut.symbol ?? "TOKEN"}`;

    // If no wallet connected, return intent + ops for external execution
    if (!walletClient) {
      return { intent: pretty, ops, chain: chainId };
    }

    // Execute via your client (will naturally run approvals first, then router)
    const hash = await client.executeOps(ops, chainId);
    return { intent: pretty, ops, chain: chainId, hash };
  },
});
