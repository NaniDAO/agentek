import { 
  PROTOCOL_API_ENDPOINTS, 
  DefiLlamaResponse, 
  DefiLlamaChartResponse,
} from '../constants.js';
import { providerJSON } from '../../utils/fetch.js';

// Fetch pool data from DefiLlama
let poolCache: {at: number; value: DefiLlamaResponse} | undefined;
let poolRequest: Promise<DefiLlamaResponse> | undefined;
export async function fetchDefiLlamaPools(): Promise<DefiLlamaResponse> {
  if (poolCache && Date.now() - poolCache.at < 60000) return poolCache.value;
  poolRequest ??= (async () => {
    const value = await providerJSON(PROTOCOL_API_ENDPOINTS.DefiLlama, {}, "DefiLlama pool request failed", {maximumBytes: 32 * 1024 * 1024});
    if (!Array.isArray(value?.data)) throw new Error("Malformed pool catalogue");
    // Readers filter/sort their own arrays. Freeze the catalogue once instead
    // of cloning tens of thousands of pool records for every comparison.
    value.data.forEach((pool: object) => Object.freeze(pool));
    Object.freeze(value.data); Object.freeze(value);
    poolCache = {at: Date.now(), value};
    return value;
  })().finally(() => { poolRequest = undefined; });
  return poolRequest;
}

// Fetch historical chart data for a specific pool
export async function fetchPoolHistoricalData(poolId: string): Promise<DefiLlamaChartResponse> {
  const apiUrl = `${PROTOCOL_API_ENDPOINTS.DefiLlamaChart}/${poolId}`;
  
  const data = await providerJSON<DefiLlamaChartResponse>(apiUrl, {}, "DefiLlama history request failed");

  if (!data.data || data.data.length === 0) {
    throw new Error(`No historical data found for pool ID: ${poolId}`);
  }
  
  return data;
}
