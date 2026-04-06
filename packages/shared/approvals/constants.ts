import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
} from "viem/chains";

export const approvalChains = [mainnet, arbitrum, base, optimism, polygon];

/**
 * Blockscout Etherscan-compatible API base URLs (v1).
 * The getLogs endpoint supports cross-contract topic filtering
 * which is needed to find Approval events emitted by token contracts
 * where the user is the owner (topic1).
 */
export const BLOCKSCOUT_ENDPOINTS: Record<number, string> = {
  [mainnet.id]: "https://eth.blockscout.com/api",
  [polygon.id]: "https://polygon.blockscout.com/api",
  [arbitrum.id]: "https://arbitrum.blockscout.com/api",
  [optimism.id]: "https://optimism.blockscout.com/api",
  [base.id]: "https://base.blockscout.com/api",
};

/**
 * ERC-20 Approval(address indexed owner, address indexed spender, uint256 value)
 */
export const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
