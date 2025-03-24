import { createTool } from "../client.js";
import { z } from "zod";
import { aavePoolAbi, getAavePoolAddress, supportedChains } from "./constants.js";
import { formatUnits } from "viem";

const formatRate = (rate: bigint) =>
  `${(Number(formatUnits(rate, 27)) * 100).toFixed(2)}%`;
const isZeroAddress = (address: string) =>
  address === "0x0000000000000000000000000000000000000000";

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

    const result = (await publicClient.readContract({
      address: poolAddress as `0x${string}`,
      abi: aavePoolAbi,
      functionName: "getUserAccountData",
      args: [args.userAddress],
    })) as [bigint, bigint, bigint, bigint, bigint, bigint];

    const [
      totalCollateralBase,
      totalDebtBase,
      availableBorrowsBase,
      currentLiquidationThreshold,
      ltv,
      healthFactor,
    ] = result;

    return {
      summary: {
        totalCollateralUSD: `$${Number(formatUnits(totalCollateralBase, 8)).toFixed(2)}`,
        totalDebtUSD: `$${Number(formatUnits(totalDebtBase, 8)).toFixed(2)}`,
        availableToBorrowUSD: `$${Number(formatUnits(availableBorrowsBase, 8)).toFixed(2)}`,
        loanToValue: `${Number(formatUnits(ltv, 2)).toFixed(2)}%`,
        liquidationThreshold: `${Number(formatUnits(currentLiquidationThreshold, 2)).toFixed(2)}%`,
        healthFactor:
          healthFactor >= BigInt(1e9)
            ? "∞"
            : Number(formatUnits(healthFactor, 18)).toFixed(2),
      },
      riskAssessment: {
        status:
          healthFactor > BigInt(1e18)
            ? "HEALTHY"
            : healthFactor > BigInt(1e18)
              ? "SAFE"
              : "AT RISK",
        canBorrow: availableBorrowsBase > BigInt(0) ? "YES" : "NO",
        liquidationRisk:
          healthFactor < BigInt(1.1e18)
            ? "HIGH"
            : healthFactor < BigInt(2e18)
              ? "MEDIUM"
              : "LOW",
      },
      rawData: {
        totalCollateralBase: totalCollateralBase.toString(),
        totalDebtBase: totalDebtBase.toString(),
        availableBorrowsBase: availableBorrowsBase.toString(),
        currentLiquidationThreshold: currentLiquidationThreshold.toString(),
        ltv: ltv.toString(),
        healthFactor: healthFactor.toString(),
      },
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

    const result = (await publicClient.readContract({
      address: poolAddress,
      abi: aavePoolAbi,
      functionName: "getReserveData",
      args: [args.asset],
    })) as {
      configuration: { data: bigint };
      liquidityIndex: bigint;
      currentLiquidityRate: bigint;
      variableBorrowIndex: bigint;
      currentVariableBorrowRate: bigint;
      currentStableBorrowRate: bigint;
      lastUpdateTimestamp: number;
      id: number;
      aTokenAddress: string;
      stableDebtTokenAddress: string;
      variableDebtTokenAddress: string;
      interestRateStrategyAddress: string;
      accruedToTreasury: bigint;
      unbacked: bigint;
      isolationModeTotalDebt: bigint;
    };

    return {
      summary: {
        assetStatus:
          Number(result.configuration.data) > 0 ? "ACTIVE" : "INACTIVE",
        supplyAPY: formatRate(result.currentLiquidityRate),
        variableBorrowAPY: formatRate(result.currentVariableBorrowRate),
        stableBorrowAPY: formatRate(result.currentStableBorrowRate),
        lastUpdate: new Date(result.lastUpdateTimestamp * 1000).toISOString(),
      },
      tokens: {
        aToken: !isZeroAddress(result.aTokenAddress)
          ? result.aTokenAddress
          : "Not Available",
        stableDebtToken: !isZeroAddress(result.stableDebtTokenAddress)
          ? result.stableDebtTokenAddress
          : "Not Available",
        variableDebtToken: !isZeroAddress(result.variableDebtTokenAddress)
          ? result.variableDebtTokenAddress
          : "Not Available",
      },
      metrics: {
        liquidityIndex: Number(formatUnits(result.liquidityIndex, 27)).toFixed(
          8,
        ),
        accruedToTreasury: Number(
          formatUnits(result.accruedToTreasury, 27),
        ).toFixed(8),
        unbacked: Number(formatUnits(result.unbacked, 27)).toFixed(8),
        isolationModeTotalDebt: Number(
          formatUnits(result.isolationModeTotalDebt, 27),
        ).toFixed(8),
      },
      rawData: {
        configuration: result.configuration.data.toString(),
        liquidityIndex: result.liquidityIndex.toString(),
        currentLiquidityRate: result.currentLiquidityRate.toString(),
        variableBorrowIndex: result.variableBorrowIndex.toString(),
        currentVariableBorrowRate: result.currentVariableBorrowRate.toString(),
        currentStableBorrowRate: result.currentStableBorrowRate.toString(),
        lastUpdateTimestamp: result.lastUpdateTimestamp,
        id: result.id,
        aTokenAddress: result.aTokenAddress,
        stableDebtTokenAddress: result.stableDebtTokenAddress,
        variableDebtTokenAddress: result.variableDebtTokenAddress,
        interestRateStrategyAddress: result.interestRateStrategyAddress,
        accruedToTreasury: result.accruedToTreasury.toString(),
        unbacked: result.unbacked.toString(),
        isolationModeTotalDebt: result.isolationModeTotalDebt.toString(),
      },
    };
  },
});
