// Helper function to get chain name
export function getChainName(chainId: number): string {
  const chainMap: Record<number, string> = {
    1: 'Ethereum',
    4663: 'Robinhood Chain',
    10: 'Optimism',
    137: 'Polygon',
    42161: 'Arbitrum',
    8453: 'Base',
    43114: 'Avalanche',
    56: 'BSC',
    250: 'Fantom',
    100: 'Gnosis',
    1399811149: 'Solana',
    1101: 'Polygon zkEVM',
    324: 'zkSync Era',
  };
  
  return chainMap[chainId] || `Chain ${chainId}`;
}

// Chain ID mapping for DefiLlama
export const chainIdMap: Record<string, number> = {
  'Ethereum': 1,
  'Robinhood Chain': 4663,
  'Robinhood': 4663,
  'Optimism': 10,
  'Polygon': 137,
  'Arbitrum': 42161,
  'Base': 8453,
  'Avalanche': 43114,
  'BSC': 56,
  'Fantom': 250,
  'Gnosis': 100,
  'Solana': 1399811149,
  'Polygon zkEVM': 1101,
  'zkSync Era': 324,
};

// Get protocol project filter for DefiLlama
export function getProjectFilter(protocol: string): string | null {
  const projectMap: Record<string, string> = {
    'Aave': 'aave',
    'Compound': 'compound',
    'Morpho': 'morpho',
    'SparkLend': 'spark',
    'Lido': 'lido',
    'RocketPool': 'rocket-pool',
  };
  
  return projectMap[protocol] || null;
}