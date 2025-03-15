import { DefiLlamaChartDataPoint } from '../constants';
import { formatUSD } from './helpers';

export interface TimeSeriesStats {
  average: string;
  min: string;
  max: string;
  volatility?: string;
}

export interface PoolStats {
  apy: TimeSeriesStats;
  tvl: Omit<TimeSeriesStats, 'volatility'>;
}

// Calculate statistics for APY values
export function calculateApyStats(values: number[]): TimeSeriesStats {
  if (values.length === 0) {
    return {
      average: '0.00%',
      min: '0.00%',
      max: '0.00%',
      volatility: '0.00%'
    };
  }

  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  // Calculate volatility (standard deviation)
  const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  const volatility = Math.sqrt(variance);
  
  return {
    average: `${avg.toFixed(2)}%`,
    min: `${min.toFixed(2)}%`,
    max: `${max.toFixed(2)}%`,
    volatility: `${volatility.toFixed(2)}%`
  };
}

// Calculate statistics for TVL values
export function calculateTvlStats(values: number[]): Omit<TimeSeriesStats, 'volatility'> {
  if (values.length === 0) {
    return {
      average: '$0.00',
      min: '$0.00',
      max: '$0.00'
    };
  }

  const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  return {
    average: formatUSD(avg),
    min: formatUSD(min),
    max: formatUSD(max)
  };
}

// Extract and filter time series data
export function extractTimeSeriesData(data: DefiLlamaChartDataPoint[], days: number): DefiLlamaChartDataPoint[] {
  // Sort data by timestamp (oldest to newest)
  const sortedData = [...data].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Filter data by requested days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return sortedData.filter(point => 
    new Date(point.timestamp) >= cutoffDate
  );
}

// Calculate stability score (inverse of normalized volatility)
export function calculateStabilityScore(avgApy: number, volatility: number): number {
  if (avgApy === 0 || volatility === 0) return 100; // Avoid division by zero
  
  // Higher score means more stable (100 is max)
  return Math.min(100, Math.max(0, 100 - (volatility / avgApy * 100)));
}