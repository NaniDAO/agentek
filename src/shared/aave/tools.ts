import { createTool } from "../client";
import { z } from "zod";
import { aavePoolAbi, getAavePoolAddress, supportedChains } from "./constants";

export const getAaveUserData = createTool({
  name: "getAaveUserData",
  description:
    "Fetches Aave user data including total collateral, total debt, available borrowing power, current liquidation threshold, LTV, and health factor.",
  parameters: z.object({
    userAddress: z.string().describe("The user's wallet address."),
    chainId: z.number().describe("The chain ID where Aave is deployed."),
  }),
  supportedChains,
  async execute(client, args) {
    const publicClient = client.getPublicClient(args.chainId);
    const poolAddress = getAavePoolAddress(args.chainId);
    // Call the Aave Pool function getUserAccountData(address user)
    const accountData = await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: aavePoolAbi,
      functionName: "getUserAccountData",
      args: [args.userAddress],
    });
    // Expected returned tuple (all BigInts):
    // [totalCollateralETH, totalDebtETH, availableBorrowsETH, currentLiquidationThreshold, ltv, healthFactor]
    return {
      totalCollateralETH: accountData.totalCollateralETH.toString(),
      totalDebtETH: accountData.totalDebtETH.toString(),
      availableBorrowsETH: accountData.availableBorrowsETH.toString(),
      currentLiquidationThreshold:
        accountData.currentLiquidationThreshold.toString(),
      ltv: accountData.ltv.toString(),
      healthFactor: accountData.healthFactor.toString(),
    };
  },
});

export const getAaveReserveData = createTool({
  name: "getAaveReserveData",
  description:
    "Fetches reserve data for a given asset from Aave including available liquidity, total stable and variable debt, and interest rates.",
  parameters: z.object({
    asset: z.string().describe("The token contract address of the asset."),
    chainId: z.number().describe("Chain ID where Aave is deployed."),
  }),
  supportedChains,
  async execute(client, args) {
    const publicClient = client.getPublicClient(args.chainId);
    const poolAddress = getAavePoolAddress(args.chainId);
    // Call the Aave Pool function getReserveData(address asset)
    const reserveData = await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: aavePoolAbi,
      functionName: "getReserveData",
      args: [args.asset],
    });
    return {
      availableLiquidity: reserveData.availableLiquidity.toString(),
      totalStableDebt: reserveData.totalStableDebt.toString(),
      totalVariableDebt: reserveData.totalVariableDebt.toString(),
      liquidityRate: reserveData.liquidityRate.toString(),
      stableBorrowRate: reserveData.stableBorrowRate.toString(),
      variableBorrowRate: reserveData.variableBorrowRate.toString(),
      liquidityIndex: reserveData.liquidityIndex.toString(),
      variableBorrowIndex: reserveData.variableBorrowIndex.toString(),
    };
  },
});
