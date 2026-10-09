import { isAddress } from "viem";
import { z } from "zod";
import type { GymChainName } from "../environment/types.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const ASSET_SYMBOL = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
const DECIMAL_AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

const boundedString = (label: string, max: number) =>
  z.string().trim().min(1, `${label} cannot be empty`).max(max);

export const decimalAmountSchema = z
  .string()
  .regex(DECIMAL_AMOUNT, "Expected a non-negative decimal string");

export const addressSchema = z
  .string()
  .refine((value) => isAddress(value), "Expected an EVM address");

export const assetSchema = z.string().refine(
  (value) => ASSET_SYMBOL.test(value) || isAddress(value),
  "Expected an asset symbol or EVM token address",
);

export const accountReferenceSchema = z.union([
  z.literal("agent"),
  addressSchema,
]);

export const comparisonOperatorSchema = z.enum(["gte", "lte", "eq"]);
export const chainSchema = z.enum(["ethereum", "optimism", "arbitrum", "base", "polygon"]);

const comparisonFields = {
  operator: comparisonOperatorSchema,
  value: decimalAmountSchema,
  tolerance: decimalAmountSchema.optional(),
};

const validateTolerance = (
  value: { operator: "gte" | "lte" | "eq"; tolerance?: string },
  context: z.RefinementCtx,
) => {
  if (value.tolerance !== undefined && value.operator !== "eq") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tolerance"],
      message: "tolerance is only valid with the eq operator",
    });
  }
};

export const balanceGraderSchema = z
  .object({
    type: z.literal("balance"),
    chain: chainSchema.optional(),
    asset: assetSchema,
    account: accountReferenceSchema.default("agent"),
    ...comparisonFields,
  })
  .strict()
  .superRefine(validateTolerance);

export const allowanceGraderSchema = z
  .object({
    type: z.literal("allowance"),
    chain: chainSchema.optional(),
    token: assetSchema.refine(
      (value) => value.toUpperCase() !== "ETH",
      "Native ETH does not support allowances",
    ),
    owner: accountReferenceSchema.default("agent"),
    spender: addressSchema,
    ...comparisonFields,
  })
  .strict()
  .superRefine(validateTolerance);

export const acrossSettlementGraderSchema = z.object({
  type: z.literal("acrossSettlement"),
  originChain: chainSchema,
  destinationChain: chainSchema,
  recipient: addressSchema,
  outputToken: addressSchema,
}).strict();

export const outputGraderSchema = z.object({
  type: z.literal("outputContains"),
  value: z.string().min(1).max(256),
  caseSensitive: z.boolean().optional(),
}).strict();

export const contractViewGraderSchema = z.object({
  type: z.literal("contractView"),
  chain: chainSchema.optional(),
  address: addressSchema,
  abi: z.array(z.any()).min(1).max(32),
  functionName: boundedString("functionName", 128),
  args: z.array(z.union([z.string(), z.number(), z.boolean()])).max(16).optional(),
  decimals: z.number().int().min(0).max(36).default(0),
  ...comparisonFields,
}).strict().superRefine(validateTolerance);

export const mvpGraderDefinitionSchema = z.union([
  balanceGraderSchema,
  allowanceGraderSchema,
  acrossSettlementGraderSchema,
  outputGraderSchema,
  contractViewGraderSchema,
]);

const walletBalancesSchema = z
  .record(assetSchema, decimalAmountSchema)
  .refine((balances) => Object.keys(balances).length > 0, {
    message: "wallet.balances must contain at least one asset",
  });

const assetMetadataSchema = z.object({
  address: addressSchema,
  decimals: z.number().int().min(0).max(36),
  balanceSlot: z.number().int().nonnegative().optional(),
}).strict();

const walletChainSchema = z.object({
  balances: walletBalancesSchema,
  assets: z.record(assetMetadataSchema).optional(),
}).strict();

const forkChainSchema = z.object({
  chain: chainSchema,
  blockNumber: z.number().int().nonnegative().safe(),
  hardfork: z.enum(["shanghai", "cancun", "prague"]).optional(),
}).strict();

const multiChainEnvironmentSchema = z.object({
  chains: z.array(forkChainSchema).min(2).max(5),
  across: z.object({
    chains: z.array(z.object({
      chain: chainSchema,
      spokePool: addressSchema,
      assets: z.record(assetMetadataSchema.omit({ address: true })).optional(),
    }).strict()).min(2).max(5),
  }).strict(),
}).strict();

const toolsSchema = z
  .array(z.string().regex(TOOL_NAME, "Invalid Agentek tool name"))
  .min(1)
  .max(128)
  .superRefine((tools, context) => {
    const seen = new Set<string>();
    tools.forEach((tool, index) => {
      if (seen.has(tool)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate tool: ${tool}`,
        });
      }
      seen.add(tool);
    });
  });

export const mvpTaskSchema = z
  .object({
    id: z.string().regex(TASK_ID, "Invalid task id"),
    category: z.string().regex(TASK_ID, "Invalid task category").optional(),
    name: boundedString("Task name", 256),
    objective: boundedString("Objective", 50_000),
    environment: z.union([
      forkChainSchema.extend({ chain: z.literal("ethereum") }),
      multiChainEnvironmentSchema,
    ]),
    wallet: z
      .object({
        balances: walletBalancesSchema.optional(),
        chains: z.record(chainSchema, walletChainSchema).optional(),
      })
      .strict(),
    safety: z.object({
      allowedTransactionTargets: z.record(chainSchema, z.array(addressSchema)).optional(),
      maxGasUsed: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
      maxReverts: z.number().int().nonnegative().optional(),
      balanceFloors: z.array(balanceGraderSchema.refine((grader) => grader.operator === "gte",
        "Safety balance floors must use gte")).optional(),
    }).strict().optional(),
    tools: toolsSchema,
    limits: z
      .object({
        maxSteps: z.number().int().min(1).max(10_000),
        maxTransactions: z.number().int().min(0).max(10_000),
        maxReverts: z.number().int().min(0).max(10_000),
        timeoutMs: z.number().int().min(1).max(86_400_000),
        maxModelRequests: z.number().int().min(2).max(20).optional(),
      })
      .strict(),
    graders: z.array(mvpGraderDefinitionSchema).min(1).max(128),
  })
  .strict()
  .superRefine((task, context) => {
    if ("chains" in task.environment) {
      const forkChains = task.environment.chains.map(({ chain }) => chain);
      if (new Set(forkChains).size !== forkChains.length) {
        context.addIssue({ code: "custom", path: ["environment", "chains"], message: "Duplicate fork chain" });
      }
      const acrossChains = task.environment.across.chains.map(({ chain }) => chain);
      if (new Set(acrossChains).size !== acrossChains.length ||
          acrossChains.length !== forkChains.length ||
          acrossChains.some((chain) => !forkChains.includes(chain))) {
        context.addIssue({ code: "custom", path: ["environment", "across", "chains"], message: "Across chains must match fork chains exactly" });
      }
      if (task.wallet.balances || !task.wallet.chains ||
          forkChains.some((chain) => !task.wallet.chains?.[chain])) {
        context.addIssue({ code: "custom", path: ["wallet"], message: "Multi-chain tasks require wallet.chains for every fork and no wallet.balances" });
      }
      for (const [index, grader] of task.graders.entries()) {
        const gradedChains = grader.type === "outputContains"
          ? []
          : grader.type === "acrossSettlement"
          ? [grader.originChain, grader.destinationChain]
          : [grader.chain ?? "ethereum"];
        if (gradedChains.some((chain) => !forkChains.includes(chain))) {
          context.addIssue({ code: "custom", path: ["graders", index], message: "Grader references an unconfigured fork chain" });
        }
      }
      for (const [index, grader] of (task.safety?.balanceFloors ?? []).entries()) {
        if (!forkChains.includes(grader.chain ?? "ethereum")) {
          context.addIssue({ code: "custom", path: ["safety", "balanceFloors", index], message: "Safety floor references an unconfigured fork chain" });
        }
      }
      if (Object.keys(task.safety?.allowedTransactionTargets ?? {}).some((chain) => !forkChains.includes(chain as GymChainName))) {
        context.addIssue({ code: "custom", path: ["safety", "allowedTransactionTargets"], message: "Safety target allowlist references an unconfigured fork chain" });
      }
    } else if (!task.wallet.balances || task.wallet.chains) {
      context.addIssue({ code: "custom", path: ["wallet"], message: "Single-chain tasks require wallet.balances and no wallet.chains" });
    } else if (task.graders.some((grader) => grader.type === "acrossSettlement")) {
      context.addIssue({ code: "custom", path: ["graders"], message: "Across settlement grading requires a multi-chain environment" });
    } else if (task.graders.some((grader) => grader.type !== "outputContains" &&
               "chain" in grader && grader.chain && grader.chain !== "ethereum")) {
      context.addIssue({ code: "custom", path: ["graders"], message: "Single-chain graders may only reference ethereum" });
    } else if ((task.safety?.balanceFloors ?? []).some((grader) => grader.chain && grader.chain !== "ethereum") ||
               Object.keys(task.safety?.allowedTransactionTargets ?? {}).some((chain) => chain !== "ethereum")) {
      context.addIssue({ code: "custom", path: ["safety"], message: "Single-chain safety rules may only reference ethereum" });
    }
  });

export type BalanceGraderDefinition = z.infer<typeof balanceGraderSchema>;
export type AllowanceGraderDefinition = z.infer<typeof allowanceGraderSchema>;
export type MvpGraderDefinition = z.infer<typeof mvpGraderDefinitionSchema>;
export type SingleChainTaskEnvironment = { chain: "ethereum"; blockNumber: number;
  hardfork?: "shanghai" | "cancun" | "prague" };
export type MultiChainTaskEnvironment = {
  chains: { chain: GymChainName; blockNumber: number;
    hardfork?: "shanghai" | "cancun" | "prague" }[];
  across: { chains: {
    chain: GymChainName;
    spokePool: `0x${string}`;
    assets?: Record<string, { decimals: number; balanceSlot?: number }>;
  }[] };
};
export type MvpTask = Omit<z.infer<typeof mvpTaskSchema>, "environment"> & {
  environment: SingleChainTaskEnvironment | MultiChainTaskEnvironment;
};
export type TaskChain = GymChainName;
