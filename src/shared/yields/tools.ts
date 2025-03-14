import { z } from 'zod';
import { createTool } from '../client';
import { 
  SUPPORTED_YIELD_PROTOCOLS, 
  YieldProtocol, 
  PROTOCOL_API_ENDPOINTS, 
  RISK_THRESHOLDS,
  RiskLevel,
  YieldData,
  SUPPORTED_CHAINS,
  DefiLlamaResponse,
  DefiLlamaChartResponse,
  PoolComparisonResult
} from './constants';

// Schema for getYieldTool parameters
const getYieldToolSchema = z.object({
  protocol: z
    .enum([SUPPORTED_YIELD_PROTOCOLS[0], ...SUPPORTED_YIELD_PROTOCOLS.slice(1)] as [string, ...string[]])
    .optional()
    .describe('Optional filter for specific protocol (e.g., Aave, Compound)'),
  minApy: z
    .number()
    .min(0)
    .optional()
    .describe('Optional minimum APY threshold (e.g., 5 for 5%)'),
  maxRisk: z
    .enum(['low', 'medium', 'high'] as [string, ...string[]])
    .optional()
    .describe('Optional maximum risk level (low, medium, high)'),
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
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of results to return'),
});

type GetYieldToolParams = z.infer<typeof getYieldToolSchema>;

// Risk assessment function
function assessRisk(apy: number): RiskLevel {
  if (apy > RISK_THRESHOLDS.medium) return 'high';
  if (apy > RISK_THRESHOLDS.low) return 'medium';
  return 'low';
}

// Chain ID mapping for DefiLlama
const chainIdMap: Record<string, number> = {
  'Ethereum': 1,
  'Optimism': 10,
  'Polygon': 137,
  'Arbitrum': 42161,
  'Base': 8453,
  'Avalanche': 43114,
  'BSC': 56,
  'Fantom': 250,
  'Gnosis': 100,
  'Solana': 1399811149, // This is not an EVM chain but included for completeness
  'Polygon zkEVM': 1101,
  'zkSync Era': 324,
};

// Get protocol project filter for DefiLlama
function getProjectFilter(protocol: YieldProtocol): string | null {
  switch (protocol) {
    case 'Aave':
      return 'aave';
    case 'Compound':
      return 'compound';
    case 'Morpho':
      return 'morpho';
    case 'SparkLend':
      return 'spark';
    case 'Lido':
      return 'lido';
    case 'RocketPool':
      return 'rocket-pool';
    default:
      return null;
  }
}

// Normalized fetching logic for different protocols
async function fetchProtocolData(protocol: YieldProtocol, chainId?: number): Promise<YieldData[]> {
  try {
    // Fetch data from DefiLlama yields API
    const response = await fetch(PROTOCOL_API_ENDPOINTS.DefiLlama);
    if (!response.ok) {
      throw new Error(`Failed to fetch from DefiLlama: ${response.statusText}`);
    }
    const data: DefiLlamaResponse = await response.json();
    
    // Filter by project if specific protocol is requested (except DefiLlama)
    let filteredData = data.data;
    if (protocol !== 'DefiLlama') {
      const projectFilter = getProjectFilter(protocol);
      if (projectFilter) {
        filteredData = filteredData.filter(pool => 
          pool.project.toLowerCase().includes(projectFilter.toLowerCase())
        );
      }
    }
    
    // Filter by chain ID if specified
    if (chainId) {
      filteredData = filteredData.filter(pool => {
        const poolChainId = chainIdMap[pool.chain];
        return poolChainId === chainId;
      });
    }
    
    // Map to YieldData format
    return filteredData.map(pool => {
      // Get apy value, using base APY if total APY is null
      const apyValue = pool.apy !== null ? pool.apy : 
                      (pool.apyBase !== null ? pool.apyBase : 0);
      
      return {
        protocol: protocol as YieldProtocol,
        asset: pool.project,
        symbol: pool.symbol,
        apy: apyValue,
        tvl: pool.tvlUsd,
        chain: chainIdMap[pool.chain] || 1, // Default to Ethereum if chain not found
        risk: assessRisk(apyValue),
      };
    });
  } catch (error) {
    console.error(`Error fetching yield data for ${protocol}:`, error);
    return [];
  }
}

// The main yield analyzer tool
export const getYieldTool = createTool({
  name: 'getYieldTool',
  description: 'Analyzes and compares yield opportunities across major DeFi protocols',
  supportedChains: SUPPORTED_CHAINS,
  parameters: getYieldToolSchema,
  execute: async (client, args) => {
    const { protocol, minApy, maxRisk, asset, chainId, limit } = args;
    try {
      // Determine which protocols to fetch data from
      const protocolsToFetch = protocol ? [protocol] : SUPPORTED_YIELD_PROTOCOLS;
      
      // Fetch data from all specified protocols
      const allYieldDataPromises = protocolsToFetch.map(p => fetchProtocolData(p, chainId));
      const allYieldDataArrays = await Promise.all(allYieldDataPromises);
      let allYieldData = allYieldDataArrays.flat();
      
      // Apply filters
      if (minApy !== undefined) {
        allYieldData = allYieldData.filter(data => data.apy >= minApy);
      }
      
      if (maxRisk) {
        const riskLevels = { low: 1, medium: 2, high: 3 };
        const maxRiskLevel = riskLevels[maxRisk];
        allYieldData = allYieldData.filter(
          data => riskLevels[data.risk] <= maxRiskLevel
        );
      }
      
      if (asset) {
        const assetLower = asset.toLowerCase();
        allYieldData = allYieldData.filter(
          data => 
            data.asset.toLowerCase().includes(assetLower) || 
            data.symbol.toLowerCase().includes(assetLower)
        );
      }
      
      // Sort by APY (highest first)
      allYieldData.sort((a, b) => b.apy - a.apy);
      
      // Limit results
      const limitedResults = allYieldData.slice(0, limit);
      
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

// The yield history tool
export const getYieldHistoryTool = createTool({
  name: 'getYieldHistoryTool',
  description: 'Fetches and analyzes historical yield data for a specific pool from DefiLlama',
  supportedChains: SUPPORTED_CHAINS,
  parameters: getYieldHistoryToolSchema,
  execute: async (client, args) => {
    const { poolId, days } = args;
    try {
      // Construct the API URL with the pool ID
      const apiUrl = `${PROTOCOL_API_ENDPOINTS.DefiLlamaChart}/${poolId}`;
      
      // Fetch data from DefiLlama chart API
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch from DefiLlama: ${response.statusText}`);
      }
      
      const data: DefiLlamaChartResponse = await response.json();
      
      if (!data.data || data.data.length === 0) {
        throw new Error(`No historical data found for pool ID: ${poolId}`);
      }
      
      // Sort data by timestamp (oldest to newest)
      const sortedData = [...data.data].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Filter data by requested days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const filteredData = sortedData.filter(point => 
        new Date(point.timestamp) >= cutoffDate
      );
      
      // Calculate statistics
      const apyValues = filteredData.map(point => point.apy);
      const tvlValues = filteredData.map(point => point.tvlUsd);
      
      const avgApy = apyValues.reduce((sum, apy) => sum + apy, 0) / apyValues.length;
      const minApy = Math.min(...apyValues);
      const maxApy = Math.max(...apyValues);
      
      const avgTvl = tvlValues.reduce((sum, tvl) => sum + tvl, 0) / tvlValues.length;
      const minTvl = Math.min(...tvlValues);
      const maxTvl = Math.max(...tvlValues);
      
      // Calculate volatility (standard deviation of APY)
      const apyVariance = apyValues.reduce((sum, apy) => sum + Math.pow(apy - avgApy, 2), 0) / apyValues.length;
      const apyVolatility = Math.sqrt(apyVariance);
      
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
          apy: {
            average: `${avgApy.toFixed(2)}%`,
            min: `${minApy.toFixed(2)}%`,
            max: `${maxApy.toFixed(2)}%`,
            volatility: `${apyVolatility.toFixed(2)}%`,
          },
          tvl: {
            average: formatUSD(avgTvl),
            min: formatUSD(minTvl),
            max: formatUSD(maxTvl),
          },
        },
        timeline: timelineData,
      };
    } catch (error) {
      throw new Error(`Failed to fetch yield history data: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

// Helper function to calculate projected earnings
function calculateProjectedEarnings(amount: number, apy: number, days: number): number {
  // Convert APY to daily rate
  const dailyRate = (1 + apy / 100) ** (1 / 365) - 1;
  // Compound interest formula
  return amount * ((1 + dailyRate) ** days - 1);
}

// Helper function to format USD values
function formatUSD(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Helper function to get chain name
function getChainName(chainId: number): string {
  const chainMap: Record<number, string> = {
    1: 'Ethereum',
    10: 'Optimism',
    137: 'Polygon',
    42161: 'Arbitrum',
    8453: 'Base',
  };
  
  return chainMap[chainId] || `Chain ${chainId}`;
}

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
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results to return'),
});

// DefiLlama-specific yield analyzer tool
export const defiLlamaYieldTool = createTool({
  name: 'defiLlamaYieldTool',
  description: 'Fetches and analyzes yield opportunities from DefiLlama across all DeFi protocols',
  supportedChains: SUPPORTED_CHAINS,
  parameters: defiLlamaYieldToolSchema,
  execute: async (client, args) => {
    const { chain, project, symbol, stablecoin, minApy, maxRisk, limit } = args;
    try {
      // Fetch data from DefiLlama yields API
      const response = await fetch(PROTOCOL_API_ENDPOINTS.DefiLlama);
      if (!response.ok) {
        throw new Error(`Failed to fetch from DefiLlama: ${response.statusText}`);
      }
      const data: DefiLlamaResponse = await response.json();
      
      // Apply filters
      let filteredData = data.data;
      
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
    } catch (error) {
      throw new Error(`Failed to fetch DefiLlama yield data: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

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
        // Construct the API URL with the pool ID
        const apiUrl = `${PROTOCOL_API_ENDPOINTS.DefiLlamaChart}/${poolId}`;
        
        // Fetch data from DefiLlama chart API
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch from DefiLlama for pool ${poolId}: ${response.statusText}`);
        }
        
        const data: DefiLlamaChartResponse = await response.json();
        
        if (!data.data || data.data.length === 0) {
          throw new Error(`No historical data found for pool ID: ${poolId}`);
        }
        
        return { poolId, data };
      });
      
      // Wait for all API responses
      const poolResponses = await Promise.all(poolDataPromises);
      
      // Process each pool's data
      const poolResults: PoolComparisonResult[] = poolResponses.map(({ poolId, data }) => {
        // Sort data by timestamp (oldest to newest)
        const sortedData = [...data.data].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Filter data by requested days
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const filteredData = sortedData.filter(point => 
          new Date(point.timestamp) >= cutoffDate
        );
        
        // Get pool metadata from first data point
        const latestDataPoint = filteredData[filteredData.length - 1];
        const firstDataPoint = filteredData[0];
        
        // Calculate statistics
        const apyValues = filteredData.map(point => point.apy);
        const tvlValues = filteredData.map(point => point.tvlUsd);
        
        const avgApy = apyValues.reduce((sum, apy) => sum + apy, 0) / apyValues.length;
        const minApy = Math.min(...apyValues);
        const maxApy = Math.max(...apyValues);
        
        const avgTvl = tvlValues.reduce((sum, tvl) => sum + tvl, 0) / tvlValues.length;
        const minTvl = Math.min(...tvlValues);
        const maxTvl = Math.max(...tvlValues);
        
        // Calculate volatility (standard deviation of APY)
        const apyVariance = apyValues.reduce((sum, apy) => sum + Math.pow(apy - avgApy, 2), 0) / apyValues.length;
        const apyVolatility = Math.sqrt(apyVariance);
        
        // Calculate 30-day APY change if data is available
        const apyChange30d = firstDataPoint && latestDataPoint 
          ? latestDataPoint.apy - firstDataPoint.apy 
          : undefined;
        
        // Calculate stability score (inverse of normalized volatility)
        // Higher score means more stable
        const stabilityScore = 100 - (apyVolatility / avgApy * 100);
        
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
            apy: {
              average: `${avgApy.toFixed(2)}%`,
              min: `${minApy.toFixed(2)}%`,
              max: `${maxApy.toFixed(2)}%`,
              volatility: `${apyVolatility.toFixed(2)}%`
            },
            tvl: {
              average: formatUSD(avgTvl),
              min: formatUSD(minTvl),
              max: formatUSD(maxTvl)
            }
          },
          performance: {
            apyChange30d: apyChange30d !== undefined ? `${apyChange30d > 0 ? '+' : ''}${apyChange30d.toFixed(2)}%` : undefined,
            stabilityScore: parseFloat(stabilityScore.toFixed(2))
          }
        };
      });
      
      // Fetch additional pool metadata from the pools API
      const poolsResponse = await fetch(PROTOCOL_API_ENDPOINTS.DefiLlama);
      if (!poolsResponse.ok) {
        throw new Error(`Failed to fetch pool metadata from DefiLlama: ${poolsResponse.statusText}`);
      }
      
      const poolsData: DefiLlamaResponse = await poolsResponse.json();
      
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
      
      return {
        count: poolResults.length,
        period: `${days} days`,
        sortedBy: sortBy,
        bestFor: {
          highestAvgApy: apySorted[0].project + ' ' + apySorted[0].symbol,
          lowestVolatility: volatilitySorted[0].project + ' ' + volatilitySorted[0].symbol,
          bestStability: sortedResults.sort((a, b) => 
            (b.performance.stabilityScore || 0) - (a.performance.stabilityScore || 0)
          )[0].project + ' ' + sortedResults[0].symbol
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