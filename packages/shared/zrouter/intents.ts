import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { Address, Hex, PublicClient, WalletClient, encodeFunctionData, isAddress, maxUint256, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { buildRoutePlan, erc20Abi, erc6909Abi, findRoute, mainnetConfig, zRouterAbi } from "zrouter-sdk";
import { supportedChains } from './constants.js'
import { AmountSchema, SymbolOrTokenSchema } from "./types.js";
import { addressSchema } from "../utils.js";
import { asToken, resolveInputToToken, toBaseUnits } from "./utils.js";

const swapParameters = z.object({
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
    const chainId = mainnet.id;
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

    // Route + plan
    const steps = await findRoute(publicClient, {
      tokenIn: asToken(tIn),
      tokenOut: asToken(tOut),
      side: args.side as any,
      amount: baseAmount,
      deadline,
      owner,
      slippageBps: args.slippageBps,
    } as any);

    if (!steps?.length) throw new Error("No route found for the requested swap.");

    const router: Address =
      args.router ??
      (steps[0] as any)?.router ??
      (() => {
        throw new Error("Router address is required (pass 'router' or ensure findRoute returns it).");
      })();

    const plan = await buildRoutePlan(publicClient, {
      owner,
      router,
      steps,
      finalTo,
    });

    // ----- Build ops correctly -----
    const approvalOps = (plan.approvals ?? []).map((appr: any) => {
      // ERC20 approval: approve(spender, maxUint256) on token address
      if (appr.kind === "ERC20_APPROVAL") {
        if (!appr.token?.address || !appr.spender) {
          throw new Error("Invalid ERC20 approval action returned by router plan.");
        }

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

      // ERC6909 / operator approval: setOperator(operator, approved) on token address
      if (appr.kind === "ERC6909_OPERATOR" || appr.kind === "SET_OPERATOR" || appr.operator !== undefined) {
        if (!appr.token?.address || appr.operator === undefined || appr.approved === undefined) {
          throw new Error("Invalid ERC6909 operator approval action returned by router plan.");
        }
        const data = encodeFunctionData({
          abi: erc6909Abi,
          functionName: "setOperator",
          args: [appr.operator as Address, Boolean(appr.approved)],
        });
        return {
          target: appr.token.address as Address,
          value: "0",
          data: data as Hex,
        };
      }

      // Unknown approval type (fail fast so we don't send bad tx)
      throw new Error(`Unsupported approval action: ${String(appr.kind)}`);
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
