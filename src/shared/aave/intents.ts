import { createTool } from "../client";
import { z } from "zod";
import { erc20Abi, parseUnits, maxUint256, encodeFunctionData } from "viem";
import { aavePoolAbi, getAavePoolAddress, supportedChains } from "./constants";

// Intent: Deposit tokens into Aave (i.e. supply to the pool)
export const intentAaveDeposit = createTool({
  name: "intentAaveDeposit",
  description:
    "Deposits tokens into the Aave protocol to supply liquidity and earn interest.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for the deposit."),
    asset: z.string().describe("Token contract address to deposit."),
    amount: z
      .string()
      .describe("Amount of tokens to deposit (in human-readable format)."),
  }),
  async execute(client, args) {
    const walletClient = client.getWalletClient(args.chainId);
    const publicClient = client.getPublicClient(args.chainId);
    const userAddress = await client.getAddress();

    // Fetch token decimals to convert amount correctly
    const decimals = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const amountBigInt = parseUnits(args.amount, decimals);

    const poolAddress = getAavePoolAddress(args.chainId);
    // Check current allowance for the Aave Pool contract
    const currentAllowance = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [userAddress, poolAddress],
    });

    let ops = [];
    if (currentAllowance < amountBigInt) {
      // Prepare token approval operation
      const approvalData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [poolAddress, maxUint256],
      });
      ops.push({
        target: args.asset as `0x${string}`,
        value: "0",
        data: approvalData,
      });
    }
    // Prepare the Aave supply() call:
    // supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
    const supplyData = encodeFunctionData({
      abi: aavePoolAbi,
      functionName: "supply",
      args: [args.asset, amountBigInt, userAddress, 0],
    });
    ops.push({
      target: poolAddress,
      value: "0",
      data: supplyData,
    });

    const intentDescription = `Deposit ${args.amount} tokens into Aave on chain ${args.chainId}`;
    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
      };
    } else {
      const hash = await client.executeOps(ops, args.chainId);
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
        hash,
      };
    }
  },
});

// Intent: Withdraw tokens from Aave
export const intentAaveWithdraw = createTool({
  name: "intentAaveWithdraw",
  description:
    "Withdraws tokens from Aave, redeeming your supplied assets (aTokens).",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for the withdrawal."),
    asset: z.string().describe("Token contract address to withdraw."),
    amount: z
      .string()
      .describe("Amount of tokens to withdraw (in human-readable format)."),
  }),
  async execute(client, args) {
    const walletClient = client.getWalletClient(args.chainId);
    const publicClient = client.getPublicClient(args.chainId);
    const userAddress = await client.getAddress();

    const decimals = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const amountBigInt = parseUnits(args.amount, decimals);
    const poolAddress = getAavePoolAddress(args.chainId);

    // Prepare the withdraw() call:
    // withdraw(address asset, uint256 amount, address to)
    const withdrawData = encodeFunctionData({
      abi: aavePoolAbi,
      functionName: "withdraw",
      args: [args.asset, amountBigInt, userAddress],
    });
    const ops = [
      {
        target: poolAddress,
        value: "0",
        data: withdrawData,
      },
    ];
    const intentDescription = `Withdraw ${args.amount} tokens from Aave on chain ${args.chainId}`;
    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
      };
    } else {
      const hash = await client.executeOps(ops, args.chainId);
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
        hash,
      };
    }
  },
});

// Intent: Borrow tokens from Aave
export const intentAaveBorrow = createTool({
  name: "intentAaveBorrow",
  description:
    "Borrows tokens from Aave using your supplied collateral. By default, the variable rate mode (2) is used.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for borrowing."),
    asset: z.string().describe("Token contract address to borrow."),
    amount: z
      .string()
      .describe("Amount of tokens to borrow (in human-readable format)."),
    interestRateMode: z
      .number()
      .optional()
      .describe("1 for stable, 2 for variable (default is variable)."),
  }),
  async execute(client, args) {
    const walletClient = client.getWalletClient(args.chainId);
    const publicClient = client.getPublicClient(args.chainId);
    const userAddress = await client.getAddress();

    const decimals = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const amountBigInt = parseUnits(args.amount, decimals);
    const interestRateMode = args.interestRateMode ?? 2;
    const poolAddress = getAavePoolAddress(args.chainId);

    // Prepare the borrow() call:
    // borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
    const borrowData = encodeFunctionData({
      abi: aavePoolAbi,
      functionName: "borrow",
      args: [args.asset, amountBigInt, interestRateMode, 0, userAddress],
    });
    const ops = [
      {
        target: poolAddress,
        value: "0",
        data: borrowData,
      },
    ];
    const intentDescription = `Borrow ${args.amount} tokens on Aave (using ${
      interestRateMode === 1 ? "stable" : "variable"
    } rate) on chain ${args.chainId}`;
    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
      };
    } else {
      const hash = await client.executeOps(ops, args.chainId);
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
        hash,
      };
    }
  },
});

// Intent: Repay borrowed tokens on Aave
export const intentAaveRepay = createTool({
  name: "intentAaveRepay",
  description:
    "Repays your Aave debt. By default, the variable rate mode (2) is used for repayment.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for repayment."),
    asset: z.string().describe("Token contract address of the asset to repay."),
    amount: z
      .string()
      .describe("Amount of tokens to repay (in human-readable format)."),
    rateMode: z
      .number()
      .optional()
      .describe("1 for stable, 2 for variable (default is variable)."),
  }),
  async execute(client, args) {
    const walletClient = client.getWalletClient(args.chainId);
    const publicClient = client.getPublicClient(args.chainId);
    const userAddress = await client.getAddress();

    const decimals = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const amountBigInt = parseUnits(args.amount, decimals);
    const rateMode = args.rateMode ?? 2;
    const poolAddress = getAavePoolAddress(args.chainId);

    let ops = [];
    // Check allowance for repayment if needed (since tokens must be approved)
    const currentAllowance = await publicClient.readContract({
      address: args.asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [userAddress, poolAddress],
    });
    if (currentAllowance < amountBigInt) {
      const approvalData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [poolAddress, maxUint256],
      });
      ops.push({
        target: args.asset as `0x${string}`,
        value: "0",
        data: approvalData,
      });
    }
    // Prepare the repay() call:
    // repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)
    const repayData = encodeFunctionData({
      abi: aavePoolAbi,
      functionName: "repay",
      args: [args.asset, amountBigInt, rateMode, userAddress],
    });
    ops.push({
      target: poolAddress,
      value: "0",
      data: repayData,
    });
    const intentDescription = `Repay ${args.amount} tokens on Aave (using ${
      rateMode === 1 ? "stable" : "variable"
    } rate) on chain ${args.chainId}`;
    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
      };
    } else {
      const hash = await client.executeOps(ops, args.chainId);
      return {
        intent: intentDescription,
        ops,
        chain: args.chainId,
        hash,
      };
    }
  },
});
