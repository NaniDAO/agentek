import { Chain, mainnet, optimism, arbitrum, base, polygon } from 'viem/chains';

export const SUPPORTED_CHAINS: Chain[] = [mainnet, optimism, arbitrum, base, polygon];

export const SUPPORTED_YIELD_PROTOCOLS = [
  'Aave',
  'Compound',
  'Morpho',
  'SparkLend',
  'Lido',
  'RocketPool',
  'DefiLlama',
] as const;

export type YieldProtocol = typeof SUPPORTED_YIELD_PROTOCOLS[number];

export type RiskLevel = 'low' | 'medium' | 'high';

export interface YieldData {
  protocol: YieldProtocol;
  asset: string;
  symbol: string;
  apy: number;
  tvl: number;
  chain: number;
  risk: RiskLevel;
}

// DefiLlama pool interface based on their API response
export interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  rewardTokens: string[] | null;
  pool: string;
  apyPct1D?: number;
  apyPct7D?: number;
  apyPct30D?: number;
  stablecoin: boolean;
  ilRisk: string;
  exposure: string;
  predictions?: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  };
}

export interface DefiLlamaResponse {
  status: string;
  data: DefiLlamaPool[];
}

export interface DefiLlamaChartDataPoint {
  timestamp: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;
  apyBase7d: number | null;
}

export interface DefiLlamaChartResponse {
  status: string;
  data: DefiLlamaChartDataPoint[];
}

// NOTE: Some of these endpoints are mock/placeholders for demonstration only, not actual APIs
export const PROTOCOL_API_ENDPOINTS = {
  Aave: 'https://aave-api-v2.aave.com/data/markets-data',
  Compound: 'https://api.compound.finance/api/v2/markets',
  Morpho: 'https://api.morpho.org/pools',
  SparkLend: 'https://api.spark.fi/markets',
  Lido: 'https://api.lido.fi/v1/protocol/steth/apr', 
  RocketPool: 'https://api.rocketpool.net/api/apr',
  DefiLlama: 'https://yields.llama.fi/pools',
  DefiLlamaChart: 'https://yields.llama.fi/chart',
};

// Risk assessment configuration thresholds
export const RISK_THRESHOLDS = {
  low: 4,    // 0-4% APY considered low risk
  medium: 10, // 4-10% APY considered medium risk
  high: 100,  // >10% APY considered high risk
};