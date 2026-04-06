import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";

export const supportedChains = [
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
  sepolia,
];

/**
 * Blockscout v2 API base URLs for ABI auto-fetch.
 * Sepolia is excluded since Blockscout coverage varies.
 */
export const BLOCKSCOUT_API_ENDPOINTS: Record<number, string> = {
  [mainnet.id]: "https://eth.blockscout.com/api/v2",
  [polygon.id]: "https://polygon.blockscout.com/api/v2",
  [arbitrum.id]: "https://arbitrum.blockscout.com/api/v2",
  [optimism.id]: "https://optimism.blockscout.com/api/v2",
  [base.id]: "https://base.blockscout.com/api/v2",
};
