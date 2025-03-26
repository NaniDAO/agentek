import { z } from 'zod';
import { createTool } from '../client.js';
import {
  SUPPORTED_YIELD_PROTOCOLS,
  SUPPORTED_CHAINS,
  PoolComparisonResult
} from './constants.js';
import {
  formatUSD,
  getChainName,
  calculateProjectedEarnings,
  fetchProtocolData,
  fetchDefiLlamaPools,
  fetchPoolHistoricalData,
  assessRisk,
  calculateApyStats,
  calculateTvlStats,
  extractTimeSeriesData,
  calculateStabilityScore
} from './utils/index.js';

interface ChartDataPoint {
  timestamp: number
  price: number
}

interface TokenPriceData {
  symbol: string
  confidence: number
  prices: ChartDataPoint[]
}

interface TokenChartResult {
  success: boolean
  tokens: string[]
  period: string
  coins: Record<string, TokenPriceData>
}

// Schema for getTokenChartTool parameters
const getTokenChartToolSchema = z.object({
  tokens: z
    .union([z.string(), z.array(z.string())])
    .describe('Token identifier in format "chain:address" (e.g., "ethereum:0x...", "coingecko:ethereum") or array of such identifiers'),
  period: z
    .string()
    .optional()
    .default('1d')
    .describe('Time interval between data points. Format: 1h, 4h, 1d, 1w (defaults to "1d")'),
  startTime: z
    .string()
    .optional()
    .describe('ISO timestamp for the start time (e.g., "2025-01-01T00:00:00Z")'),
  options: z
    .object({
      span: z
        .number()
        .optional()
        .describe('Number of data points to return. Default to zero. To create a chart you need many data points.'),
      searchWidth: z
        .string()
        .optional()
        .describe('Time range on either side to find price data (e.g., "600" for 10 minutes)')
    })
    .optional()
    .describe('Optional configuration for the chart data')
});

// Token chart tool
export const getTokenChartTool = createTool({
  name: 'getTokenChart',
  description: 'Gets historical price chart data for one or more tokens from DeFi Llama',
  parameters: getTokenChartToolSchema,
  execute: async (_client, args): Promise<TokenChartResult> => {
    const { tokens, period, startTime, options } = args;

    try {
      const unixStartTime = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : undefined;

      // Handle single token or array of tokens
      const tickerString = Array.isArray(tokens) ? tokens.join(',') : tokens;

      const baseUrl = 'https://coins.llama.fi';
      const url = new URL(`${baseUrl}/chart/${tickerString}`);

      // Only add parameters that are defined
      const params: Record<string, string> = {
        period
      };

      // Only add start time if it exists
      if (unixStartTime !== undefined) {
        params.start = unixStartTime.toString();
      }

      // Add optional parameters if they exist
      if (options?.span) {
        params.span = options.span.toString();
      }
      if (options?.searchWidth) {
        params.searchWidth = options.searchWidth;
      }

      url.search = new URLSearchParams(params).toString();

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${url.toString()} ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        tokens: Array.isArray(tokens) ? tokens : [tokens],
        period,
        coins: data.coins
      };

    } catch (error) {
      throw new Error(`Failed to fetch token chart data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

// Schema for defiLlamaYieldTool parameters
const defiLlamaYieldToolSchema = z.object({
  chain: z
    .string()
    .optional()
    .describe('Optional filter for specific chain (e.g., Ethereum, Arbitrum)'),
  project: z
    .string()
    .optional()
    .describe('Optional filter for specific project (e.g., Aave, Lido)'),
  symbol: z
    .string()
    .optional()
    .describe('Optional filter for specific token symbol (e.g., ETH, USDC)'),
  stablecoin: z
    .boolean()
    .optional()
    .describe('Optional filter for stablecoin yields only'),
  minApy: z
    .number()
    .min(0)
    .optional()
    .describe('Optional minimum APY threshold (e.g., 5 for 5%)'),
  maxRisk: z
    .enum(['low', 'medium', 'high'] as [string, ...string[]])
    .optional()
    .describe('Optional maximum risk level (low, medium, high)'),
  protocol: z
    .enum([SUPPORTED_YIELD_PROTOCOLS[0], ...SUPPORTED_YIELD_PROTOCOLS.slice(1)] as [string, ...string[]])
    .optional()
    .describe('Optional filter for specific protocol (e.g., Aave, Compound)'),
  asset: z
    .string()
    .optional()
    .describe('Optional filter for specific asset (e.g., ETH, USDC)'),
  chainId: z
    .number()
    .optional()
    .describe('Optional chain ID filter (e.g., 1 for Ethereum, 10 for Optimism)'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results to return'),
});

// Consolidated yield analyzer tool
export const getYieldTool = createTool({
  name: 'getYieldTool',
  description: 'Analyzes and compares yield opportunities from DefiLlama across all DeFi protocols',
  supportedChains: SUPPORTED_CHAINS,
  parameters: defiLlamaYieldToolSchema,
  execute: async (client, args) => {
    const { chain, project, symbol, stablecoin, minApy, maxRisk, protocol, asset, chainId, limit } = args;
    try {
      let filteredData;

      // If protocol is specified, use fetchProtocolData
      if (protocol) {
        const protocolsToFetch = [protocol];
        // @ts-ignore - Protocol is properly typed at runtime
        const allYieldDataPromises = protocolsToFetch.map(p => fetchProtocolData(p, chainId));
        const allYieldDataArrays = await Promise.all(allYieldDataPromises);
        filteredData = allYieldDataArrays.flat();

        // Apply additional filters
        if (minApy !== undefined) {
          filteredData = filteredData.filter(data => data.apy >= minApy);
        }

        if (maxRisk) {
          const riskLevels = { low: 1, medium: 2, high: 3 };
          const maxRiskLevel = riskLevels[maxRisk];
          filteredData = filteredData.filter(
            data => riskLevels[data.risk] <= maxRiskLevel
          );
        }

        if (asset) {
          const assetLower = asset.toLowerCase();
          filteredData = filteredData.filter(
            data =>
              data.asset.toLowerCase().includes(assetLower) ||
              data.symbol.toLowerCase().includes(assetLower)
          );
        }

        // Sort by APY (highest first)
        filteredData.sort((a, b) => b.apy - a.apy);

        // Limit results
        const limitedResults = filteredData.slice(0, limit);

        return {
          count: limitedResults.length,
          yields: limitedResults.map(data => ({
            protocol: data.protocol,
            asset: `${data.asset} (${data.symbol})`,
            chain: getChainName(data.chain),
            apy: `${data.apy.toFixed(2)}%`,
            tvl: formatUSD(data.tvl),
            risk: data.risk,
          })),
        };
      }
      // Otherwise use direct DefiLlama API
      else {
        // Fetch data from DefiLlama yields API
        const data = await fetchDefiLlamaPools();

        // Apply filters
        filteredData = data.data;

        if (chain) {
          const chainLower = chain.toLowerCase();
          filteredData = filteredData.filter(pool =>
            pool.chain.toLowerCase().includes(chainLower)
          );
        }

        if (project) {
          const projectLower = project.toLowerCase();
          filteredData = filteredData.filter(pool =>
            pool.project.toLowerCase().includes(projectLower)
          );
        }

        if (symbol) {
          const symbolLower = symbol.toLowerCase();
          filteredData = filteredData.filter(pool =>
            pool.symbol.toLowerCase().includes(symbolLower)
          );
        }

        if (stablecoin !== undefined) {
          filteredData = filteredData.filter(pool => pool.stablecoin === stablecoin);
        }

        if (minApy !== undefined) {
          filteredData = filteredData.filter(pool => {
            const apyValue = pool.apy !== null ? pool.apy :
                            (pool.apyBase !== null ? pool.apyBase : 0);
            return apyValue >= minApy;
          });
        }

        if (maxRisk) {
          const riskLevels = { low: 1, medium: 2, high: 3 };
          const maxRiskLevel = riskLevels[maxRisk];

          filteredData = filteredData.filter(pool => {
            const apyValue = pool.apy !== null ? pool.apy :
                            (pool.apyBase !== null ? pool.apyBase : 0);
            const riskLevel = assessRisk(apyValue);
            return riskLevels[riskLevel] <= maxRiskLevel;
          });
        }

        if (asset) {
          const assetLower = asset.toLowerCase();
          filteredData = filteredData.filter(
            pool =>
              pool.project.toLowerCase().includes(assetLower) ||
              pool.symbol.toLowerCase().includes(assetLower)
          );
        }

        // Sort by APY (highest first)
        filteredData.sort((a, b) => {
          const apyA = a.apy !== null ? a.apy : (a.apyBase !== null ? a.apyBase : 0);
          const apyB = b.apy !== null ? b.apy : (b.apyBase !== null ? b.apyBase : 0);
          return apyB - apyA;
        });

        // Limit results
        const limitedResults = filteredData.slice(0, limit);

        // Format results
        return {
          count: limitedResults.length,
          yields: limitedResults.map(pool => {
            const apyValue = pool.apy !== null ? pool.apy :
                            (pool.apyBase !== null ? pool.apyBase : 0);

            return {
              project: pool.project,
              asset: pool.symbol,
              chain: pool.chain,
              pool: pool.pool, // Include pool ID for historical data lookup
              apy: `${apyValue.toFixed(2)}%`,
              apyBase: pool.apyBase !== null ? `${pool.apyBase.toFixed(2)}%` : null,
              apyReward: pool.apyReward !== null ? `${pool.apyReward.toFixed(2)}%` : null,
              tvl: formatUSD(pool.tvlUsd),
              risk: assessRisk(apyValue),
              stablecoin: pool.stablecoin ? 'Yes' : 'No',
              ilRisk: pool.ilRisk,
              exposure: pool.exposure,
              trend: {
                '1d': pool.apyPct1D !== undefined ? `${pool.apyPct1D > 0 ? '+' : ''}${pool.apyPct1D?.toFixed(2)}%` : 'N/A',
                '7d': pool.apyPct7D !== undefined ? `${pool.apyPct7D > 0 ? '+' : ''}${pool.apyPct7D?.toFixed(2)}%` : 'N/A',
                '30d': pool.apyPct30D !== undefined ? `${pool.apyPct30D > 0 ? '+' : ''}${pool.apyPct30D?.toFixed(2)}%` : 'N/A',
              },
              prediction: pool.predictions ? {
                class: pool.predictions.predictedClass,
                confidence: `${pool.predictions.predictedProbability}%`,
              } : null,
            };
          }),
        };
      }
    } catch (error) {
      throw new Error(`Failed to fetch yield data: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Schema for compareYieldTool parameters
const compareYieldToolSchema = z.object({
  assets: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('List of assets to compare (e.g., ["USDC", "ETH"])'),
  amount: z
    .number()
    .optional()
    .describe('Optional investment amount in USD for projected earnings'),
  duration: z
    .number()
    .optional()
    .describe('Optional investment duration in days for projected earnings'),
});

type CompareYieldToolParams = z.infer<typeof compareYieldToolSchema>;

// The yield comparison tool
export const compareYieldTool = createTool({
  name: 'compareYieldTool',
  description: 'Compares yield opportunities for specific assets across different protocols',
  supportedChains: SUPPORTED_CHAINS,
  parameters: compareYieldToolSchema,
  execute: async (client, args) => {
    const { assets, amount, duration } = args;
    try {
      // Fetch data from all protocols
      const allYieldDataPromises = SUPPORTED_YIELD_PROTOCOLS.map(p => fetchProtocolData(p));
      const allYieldDataArrays = await Promise.all(allYieldDataPromises);
      let allYieldData = allYieldDataArrays.flat();

      // Filter for the specified assets
      const assetComparisons = assets.map(assetName => {
        const assetLower = assetName.toLowerCase();
        const matchingYields = allYieldData.filter(
          data =>
            data.asset.toLowerCase().includes(assetLower) ||
            data.symbol.toLowerCase().includes(assetLower)
        );

        // Sort by APY (highest first)
        matchingYields.sort((a, b) => b.apy - a.apy);

        // If amount and duration provided, calculate projected earnings
        const topYields = matchingYields.slice(0, 5).map(data => {
          const result: any = {
            protocol: data.protocol,
            chain: getChainName(data.chain),
            apy: `${data.apy.toFixed(2)}%`,
            risk: data.risk,
          };

          if (amount !== undefined && duration !== undefined) {
            const projectedEarnings = calculateProjectedEarnings(amount, data.apy, duration);
            result.projectedEarnings = formatUSD(projectedEarnings);
            result.totalValue = formatUSD(amount + projectedEarnings);
          }

          return result;
        });

        return {
          asset: assetName,
          protocols: topYields,
          count: topYields.length,
        };
      });

      return {
        comparisons: assetComparisons,
        investmentDetails: amount !== undefined ? {
          initialAmount: formatUSD(amount),
          duration: duration !== undefined ? `${duration} days` : undefined,
        } : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to compare yields: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Schema for getYieldHistoryTool parameters
const getYieldHistoryToolSchema = z.object({
  poolId: z
    .string()
    .describe('The DefiLlama pool ID to fetch historical yield data for'),
  days: z
    .number()
    .min(1)
    .max(365)
    .optional()
    .default(30)
    .describe('Number of days of historical data to return (max 365)'),
});

type GetYieldHistoryToolParams = z.infer<typeof getYieldHistoryToolSchema>;

// The yield history tool
export const getYieldHistoryTool = createTool({
  name: 'getYieldHistoryTool',
  description: 'Fetches and analyzes historical yield data for a specific pool from DefiLlama',
  supportedChains: SUPPORTED_CHAINS,
  parameters: getYieldHistoryToolSchema,
  execute: async (client, args) => {
    const { poolId, days } = args;
    try {
      // Fetch historical data for the pool
      const data = await fetchPoolHistoricalData(poolId);

      // Process the data
      const filteredData = extractTimeSeriesData(data.data, days);

      // Extract series data
      const apyValues = filteredData.map(point => point.apy);
      const tvlValues = filteredData.map(point => point.tvlUsd);

      // Calculate statistics
      const apyStats = calculateApyStats(apyValues);
      const tvlStats = calculateTvlStats(tvlValues);

      // Get most recent data point
      const latestDataPoint = filteredData[filteredData.length - 1];

      // Format the timeline data
      const timelineData = filteredData.map(point => ({
        date: new Date(point.timestamp).toISOString().split('T')[0],
        apy: `${point.apy.toFixed(2)}%`,
        tvl: formatUSD(point.tvlUsd),
        apyBase: point.apyBase ? `${point.apyBase.toFixed(2)}%` : 'N/A',
        apyReward: point.apyReward ? `${point.apyReward.toFixed(2)}%` : 'N/A',
      }));

      return {
        poolId,
        period: `${days} days`,
        dataPoints: filteredData.length,
        current: {
          apy: `${latestDataPoint.apy.toFixed(2)}%`,
          tvl: formatUSD(latestDataPoint.tvlUsd),
          date: new Date(latestDataPoint.timestamp).toISOString().split('T')[0],
        },
        statistics: {
          apy: apyStats,
          tvl: tvlStats,
        },
        timeline: timelineData,
      };
    } catch (error) {
      throw new Error(`Failed to fetch yield history data: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Schema for compareYieldHistoryTool parameters
const compareYieldHistoryToolSchema = z.object({
  poolIds: z
    .array(z.string())
    .min(2)
    .max(5)
    .describe('List of DefiLlama pool IDs to compare (between 2-5 pools)'),
  days: z
    .number()
    .min(1)
    .max(365)
    .optional()
    .default(30)
    .describe('Number of days of historical data to analyze (max 365)'),
  sortBy: z
    .enum(['apy', 'volatility', 'stability', 'tvl'] as [string, ...string[]])
    .optional()
    .default('apy')
    .describe('Metric to sort the comparison results by'),
});

type CompareYieldHistoryToolParams = z.infer<typeof compareYieldHistoryToolSchema>;

// The compareYieldHistoryTool
export const compareYieldHistoryTool = createTool({
  name: 'compareYieldHistoryTool',
  description: 'Compares historical yield performance across multiple pools, analyzing metrics like APY, volatility, and TVL trends',
  supportedChains: SUPPORTED_CHAINS,
  parameters: compareYieldHistoryToolSchema,
  execute: async (client, args) => {
    const { poolIds, days, sortBy } = args;
    try {
      // Fetch historical data for all pools in parallel
      const poolDataPromises = poolIds.map(async (poolId) => {
        const data = await fetchPoolHistoricalData(poolId);
        return { poolId, data };
      });

      // Wait for all API responses
      const poolResponses = await Promise.all(poolDataPromises);

      // Process each pool's data
      // @ts-ignore - Type compatibility is ensured at runtime
      const poolResults: PoolComparisonResult[] = poolResponses.map(({ poolId, data }) => {
        // Extract and process time series data
        const filteredData = extractTimeSeriesData(data.data, days);

        // Get data points
        const latestDataPoint = filteredData[filteredData.length - 1];
        const firstDataPoint = filteredData[0];

        // Extract series data
        const apyValues = filteredData.map(point => point.apy);
        const tvlValues = filteredData.map(point => point.tvlUsd);

        // Calculate APY change
        const apyChange30d = firstDataPoint && latestDataPoint
          ? latestDataPoint.apy - firstDataPoint.apy
          : undefined;

        // Calculate statistics
        const avgApy = apyValues.reduce((sum, apy) => sum + apy, 0) / apyValues.length;
        const apyVolatility = parseFloat(calculateApyStats(apyValues).volatility.replace('%', ''));

        // Calculate stability score
        const stabilityScore = calculateStabilityScore(avgApy, apyVolatility);

        return {
          poolId,
          project: '', // Will be filled later
          symbol: '', // Will be filled later
          chain: '', // Will be filled later
          current: {
            apy: `${latestDataPoint.apy.toFixed(2)}%`,
            tvl: formatUSD(latestDataPoint.tvlUsd)
          },
          statistics: {
            apy: calculateApyStats(apyValues),
            tvl: calculateTvlStats(tvlValues)
          },
          performance: {
            apyChange30d: apyChange30d !== undefined ? `${apyChange30d > 0 ? '+' : ''}${apyChange30d.toFixed(2)}%` : undefined,
            stabilityScore: parseFloat(stabilityScore.toFixed(2))
          }
        };
      });

      // Fetch additional pool metadata
      const poolsData = await fetchDefiLlamaPools();

      // Add metadata to each pool result
      for (const result of poolResults) {
        const poolMetadata = poolsData.data.find(pool => pool.pool === result.poolId);
        if (poolMetadata) {
          result.project = poolMetadata.project;
          result.symbol = poolMetadata.symbol;
          result.chain = poolMetadata.chain;
        }
      }

      // Add performance rankings
      // Sort by APY (highest first)
      const apySorted = [...poolResults].sort((a, b) =>
        parseFloat(b.statistics.apy.average) - parseFloat(a.statistics.apy.average)
      );

      // Assign APY rank
      apySorted.forEach((result, index) => {
        result.performance.apyRank = index + 1;
      });

      // Sort by volatility (lowest first)
      const volatilitySorted = [...poolResults].sort((a, b) =>
        parseFloat(a.statistics.apy.volatility) - parseFloat(b.statistics.apy.volatility)
      );

      // Assign volatility rank
      volatilitySorted.forEach((result, index) => {
        result.performance.volatilityRank = index + 1;
      });

      // Sort results based on user preference
      let sortedResults = [...poolResults];
      switch (sortBy) {
        case 'apy':
          sortedResults = apySorted;
          break;
        case 'volatility':
          sortedResults = volatilitySorted;
          break;
        case 'stability':
          sortedResults.sort((a, b) =>
            (b.performance.stabilityScore || 0) - (a.performance.stabilityScore || 0)
          );
          break;
        case 'tvl':
          sortedResults.sort((a, b) =>
            parseFloat(b.statistics.tvl.average.replace(/[^\d.-]/g, '')) -
            parseFloat(a.statistics.tvl.average.replace(/[^\d.-]/g, ''))
          );
          break;
      }

      // Create stability sorted list for "best stability" recommendation
      const stabilitySorted = [...poolResults].sort((a, b) =>
        (b.performance.stabilityScore || 0) - (a.performance.stabilityScore || 0)
      );

      return {
        count: poolResults.length,
        period: `${days} days`,
        sortedBy: sortBy,
        bestFor: {
          highestAvgApy: apySorted[0].project + ' ' + apySorted[0].symbol,
          lowestVolatility: volatilitySorted[0].project + ' ' + volatilitySorted[0].symbol,
          bestStability: stabilitySorted[0].project + ' ' + stabilitySorted[0].symbol
        },
        pools: sortedResults.map(pool => ({
          poolId: pool.poolId,
          name: `${pool.project} ${pool.symbol}`,
          chain: pool.chain,
          currentApy: pool.current.apy,
          avgApy: pool.statistics.apy.average,
          volatility: pool.statistics.apy.volatility,
          stabilityScore: pool.performance.stabilityScore,
          apyRank: pool.performance.apyRank,
          volatilityRank: pool.performance.volatilityRank,
          tvlAvg: pool.statistics.tvl.average,
          apyChange: pool.performance.apyChange30d
        })),
        details: sortedResults
      };
    } catch (error) {
      throw new Error(`Failed to compare yield history: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
