import { z } from "zod";
import { createTool } from "../client";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import { formatEther, parseEther } from "viem";

const supportedChains = [mainnet, polygon, arbitrum, optimism, base];

// Note: the endpoints already include "/api/v2"
const BLOCKSCOUT_API_ENDPOINTS = new Map([
  [mainnet.id, "https://eth.blockscout.com/api/v2"],
  [polygon.id, "https://polygon.blockscout.com/api/v2"],
  [arbitrum.id, "https://arbitrum.blockscout.com/api/v2"],
  [optimism.id, "https://optimism.blockscout.com/api/v2"],
  [base.id, "https://base.blockscout.com/api/v2"],
]);

type SupportedChain = (typeof supportedChains)[number]["id"];

/**
 * Helper to call a Blockscout v2 endpoint.
 * The endpoint parameter should be the “path” (starting with a slash) after the base URL.
 * An optional query object is appended as query parameters.
 */
async function fetchFromBlockscoutV2(
  chain: SupportedChain,
  endpoint: string,
  query?: Record<string, string>,
) {
  const baseUrl = BLOCKSCOUT_API_ENDPOINTS.get(chain);
  if (!baseUrl) {
    throw new Error(`Chain ${chain} is not supported.`);
  }
  let url = `${baseUrl}${endpoint}`;
  if (query && Object.keys(query).length > 0) {
    const queryParams = new URLSearchParams(query);
    url += `?${queryParams.toString()}`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch from Blockscout: ${error.message}`);
    }
    throw error;
  }
}
/**
 * /addresses ENDPOINTS
 * - GET /addresses => Get native coin holders list
 * - GET /addresses/{address_hash} => Get address info
 * - GET /addresses/{address_hash}/counters => Get address counters
 * - GET /addresses/{address_hash}/transactions => Get address transactions
 * - GET /addresses/{address_hash}/token-transfers => Get address token transfers
 * - GET /addresses/{address_hash}/internal-transactions => Get address internal transactions
 * - GET /addresses/{address_hash}/logs => Get address logs
 * - GET /addresses/{address_hash}/blocks-validated => Get blocks validated by address
 * - GET /addresses/{address_hash}/token-balances => Get all tokens balances for the address
 * - GET /addresses/{address_hash}/tokens => Token balances with filtering and pagination
 * - GET /addresses/{address_hash}/coin-balance-history => Get address coin balance history
 * - GET /addresses/{address_hash}/coin-balance-history-by-day => Get address coin balance history by day
 * - GET /addresses/{address_hash}/withdrawals => Get address withdrawals
 * - GET /addresses/{address_hash}/nft => Get list of NFT owned by address
 * - GET /addresses/{address_hash}/nft/collections => Get list of NFT owned by address, grouped by collection
 */

/**
 * Get native coin holders
 * Get native coin holders list
 * Endpoint: GET /addresses
 */
export const getNativeCoinHolders = createTool({
  name: "getNativeCoinHolders",
  description: "Get native coin holders list",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(chain, `/addresses`);
  },
});

/**
 * Get address info
 * Get information about a specific address
 * Endpoint: GET /addresses/{address_hash}
 */
export const getAddressInfo = createTool({
  name: "getAddressInfo",
  description: "Get information about a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const response = await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}`,
    );

    const coin_balance = formatEther(BigInt(response.coin_balance));
    const coin_balance_in_usd =
      parseFloat(coin_balance) * parseFloat(response.exchange_rate);

    return {
      ...response,
      coin_balance_raw: response.coin_balance,
      coin_balance,
      coin_balance_in_usd,
    };
  },
});

/**
 * Get address counters
 * Get counters for a specific address
 * Endpoint: GET /addresses/{address_hash}/counters
 */
export const getAddressCounters = createTool({
  name: "getAddressCounters",
  description: "Get counters for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(chain, `/addresses/${address}/counters`);
  },
});

/**
 * Get address transactions
 * Get transactions for a specific address
 * Endpoint: GET /addresses/{address_hash}/transactions
 */
export const getAddressTransactions = createTool({
  name: "getAddressTransactions",
  description: "Get transactions for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/transactions`,
    );
  },
});

/**
 * Get token transfers for address
 * Get token transfers for a specific address
 * Endpoint: GET /addresses/{address_hash}/token-transfers
 */
export const getAddressTokenTransfers = createTool({
  name: "getAddressTokenTransfers",
  description: "Get token transfers for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/token-transfers`,
    );
  },
});

/**
 * Get internal transactions for address
 * Get internal transactions for a specific address
 * Endpoint: GET /addresses/{address_hash}/internal-transactions
 */
export const getAddressInternalTransactions = createTool({
  name: "getAddressInternalTransactions",
  description: "Get internal transactions for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/internal-transactions`,
    );
  },
});

/**
 * Get logs for address
 * Get logs for a specific address
 * Endpoint: GET /addresses/{address_hash}/logs
 */
export const getAddressLogs = createTool({
  name: "getAddressLogs",
  description: "Get logs for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(chain, `/addresses/${address}/logs`);
  },
});

/**
 * Get blocks validated by address
 * Get blocks validated by a specific address
 * Endpoint: GET /addresses/{address_hash}/blocks-validated
 */
export const getAddressBlocksValidated = createTool({
  name: "getAddressBlocksValidated",
  description: "Get blocks validated by a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/blocks-validated`,
    );
  },
});

/**
 * Get token balances for address
 * Get all token balances for a specific address
 * Endpoint: GET /addresses/{address_hash}/token-balances
 */
export const getAddressTokenBalances = createTool({
  name: "getAddressTokenBalances",
  description: "Get all token balances for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/token-balances`,
    );
  },
});

/**
 * Get address tokens
 * Get token balances with filtering and pagination
 * Endpoint: GET /addresses/{address_hash}/tokens
 */
export const getAddressTokens = createTool({
  name: "getAddressTokens",
  description: "Get token balances with filtering and pagination",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(chain, `/addresses/${address}/tokens`);
  },
});

/**
 * Get coin balance history
 * Get address coin balance history
 * Endpoint: GET /addresses/{address_hash}/coin-balance-history
 */
export const getAddressCoinBalanceHistory = createTool({
  name: "getAddressCoinBalanceHistory",
  description: "Get address coin balance history",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/coin-balance-history`,
    );
  },
});

/**
 * Get daily coin balance history
 * Get address coin balance history by day
 * Endpoint: GET /addresses/{address_hash}/coin-balance-history-by-day
 */
export const getAddressCoinBalanceHistoryByDay = createTool({
  name: "getAddressCoinBalanceHistoryByDay",
  description: "Get address coin balance history by day",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/coin-balance-history-by-day`,
    );
  },
});

/**
 * Get address withdrawals
 * Get withdrawals for a specific address
 * Endpoint: GET /addresses/{address_hash}/withdrawals
 */
export const getAddressWithdrawals = createTool({
  name: "getAddressWithdrawals",
  description: "Get withdrawals for a specific address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/withdrawals`,
    );
  },
});

/**
 * Get NFTs owned by address
 * Get list of NFTs owned by address
 * Endpoint: GET /addresses/{address_hash}/nft
 */
export const getAddressNFTs = createTool({
  name: "getAddressNFTs",
  description: "Get list of NFTs owned by address",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(chain, `/addresses/${address}/nft`);
  },
});

/**
 * Get NFT collections owned by address
 * Get list of NFTs owned by address, grouped by collection
 * Endpoint: GET /addresses/{address_hash}/nft/collections
 */
export const getAddressNFTCollections = createTool({
  name: "getAddressNFTCollections",
  description: "Get list of NFTs owned by address, grouped by collection",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/addresses/${address}/nft/collections`,
    );
  },
});

/**
 * /blocks ENDPOINTS
 * - GET /blocks/{block_number_or_hash} => Get block info
 * - GET /blocks/{block_number_or_hash}/transactions => Get block transactions
 * - GET /blocks/{block_number_or_hash}/withdrawals => Get block withdrawals
 */

/**
 * Get block info
 * Get information about a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}
 */
export const getBlockInfo = createTool({
  name: "getBlockInfo",
  description: "Get information about a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    blockNumberOrHash: z.union([z.string(), z.number()]),
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash } = args;
    return await fetchFromBlockscoutV2(chain, `/blocks/${blockNumberOrHash}`);
  },
});

/**
 * Get block transactions
 * Get transactions within a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}/transactions
 */
export const getBlockTransactions = createTool({
  name: "getBlockTransactions",
  description: "Get transactions within a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    blockNumberOrHash: z.union([z.string(), z.number()]),
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/blocks/${blockNumberOrHash}/transactions`,
    );
  },
});

/**
 * Get block withdrawals
 * Get withdrawals within a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}/withdrawals
 */
export const getBlockWithdrawals = createTool({
  name: "getBlockWithdrawals",
  description: "Get withdrawals within a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    blockNumberOrHash: z.union([z.string(), z.number()]),
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/blocks/${blockNumberOrHash}/withdrawals`,
    );
  },
});

/**
 * /stats ENDPOINTS
 * - GET /stats/counters => Get statistics counters for the chain
 * - GET /stats/charts/market => Get market chart data
 * - GET /stats/charts/transactions => Get daily transactions chart
 */

/**
 * Get statistics counters for the chain
 * Returns statistics counters for various blockchain metrics.
 * Endpoint: GET /stats/counters
 */
export const getStats = createTool({
  name: "getStats",
  description: "Get statistics for various blockchain metrics.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(chain, "/stats");
  },
});

/**
 * Get market chart data.
 * Returns native gas token market data chart.
 * Endpoint: GET /stats/charts/market
 */
export const getMarketChart = createTool({
  name: "getMarketChart",
  description: "Retrieve native gas token market data chart.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(chain, "/stats/charts/market");
  },
});

/**
 * Get transactions chart data.
 * Returns daily transaction statistics.
 * Endpoint: GET /stats/charts/transactions
 */
export const getTransactionsChart = createTool({
  name: "getTransactionsChart",
  description: "Retrieve daily transaction statistics chart data.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(chain, "/stats/charts/transactions");
  },
});

/**
 * /transactions ENDPOINTS
 * - GET /transactions/{txhash} => Get transaction details
 * - GET /transactions/{txhash}/token-transfers => Get token transfers
 * - GET /transactions/{txhash}/internal-transactions => Get internal transactions
 * - GET /transactions/{txhash}/logs => Get transaction logs
 * - GET /transactions/{txhash}/raw-trace => Get raw trace info
 * - GET /transactions/{txhash}/state-changes => Get state changes
 * - GET /transactions/{txhash}/summary => Get transaction summary
 */

/**
 * 13. getTransactionInfo
 * Retrieve detailed info for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}?index=...
 */
export const getTransactionInfo = createTool({
  name: "getTransactionInfo",
  description: "Retrieve detailed information for a given transaction hash.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const query: Record<string, string> = {};
    return await fetchFromBlockscoutV2(chain, `/transactions/${txhash}`, query);
  },
});

/**
 * 13. getTransactionTokenTransfers
 * Retrieve token transfers for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}/token-transfers
 */
export const getTransactionTokenTransfers = createTool({
  name: "getTransactionTokenTransfers",
  description:
    "Retrieve all token transfers that occurred within a given transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const query: Record<string, string> = {};
    return await fetchFromBlockscoutV2(
      chain,
      `/transactions/${txhash}/token-transfers`,
      query,
    );
  },
});

/**
 * getTransactionInternalTransactions
 * Retrieve internal transactions for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}/internal-transactions
 */
export const getTransactionInternalTransactions = createTool({
  name: "getTransactionInternalTransactions",
  description:
    "Retrieve internal transactions that occurred within a given transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/transactions/${txhash}/internal-transactions`,
    );
  },
});

/**
 * getTransactionLogs
 * Retrieve logs generated from a transaction.
 * Endpoint: GET /transactions/{txhash}/logs
 */
export const getTransactionLogs = createTool({
  name: "getTransactionLogs",
  description: "Retrieve logs that were generated from a specific transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    return await fetchFromBlockscoutV2(chain, `/transactions/${txhash}/logs`);
  },
});

/**
 * getTransactionRawTrace
 * Retrieve raw trace info for a transaction.
 * Endpoint: GET /transactions/{txhash}/raw-trace
 */
export const getTransactionRawTrace = createTool({
  name: "getTransactionRawTrace",
  description: "Retrieve raw trace information for a specific transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/transactions/${txhash}/raw-trace`,
    );
  },
});

/**
 * getTransactionStateChanges
 * Retrieve state changes made by a specific transaction.
 * Endpoint: GET /transactions/{txhash}/state-changes
 */
export const getTransactionStateChanges = createTool({
  name: "getTransactionStateChanges",
  description: "Retrieve state changes that occurred during a transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/transactions/${txhash}/state-changes`,
    );
  },
});

/**
 * getTransactionSummary
 * Retrieve a summary of a transaction.
 * Endpoint: GET /transactions/{txhash}/summary
 */
export const getTransactionSummary = createTool({
  name: "getTransactionSummary",
  description: "Retrieve a summary of data related to a transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    return await fetchFromBlockscoutV2(
      chain,
      `/transactions/${txhash}/summary`,
    );
  },
});

/**
 * /smart-contracts ENDPOINTS
 * - GET /smart-contracts => Get smart contracts
 * - GET /smart-contracts/{address} => Get smart contract info
 */

/**
 * 19. getContracts
 * List contract addresses known to the explorer.
 * Endpoint: GET /smart-contracts
 */
export const getSmartContracts = createTool({
  name: "getSmartContracts",
  description: "Get smart contract for the query",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    q: z.string().describe("Query to get smart contracts for"),
    language: z
      .enum(["solidity", "yul", "viper"])
      .optional()
      .describe("Optional language to query explorer for"),
  }),
  execute: async (_, args) => {
    const { chain, q, language } = args;
    const query: Record<string, string> = {};
    query["q"] = q;
    if (language) {
      query["language"] = language;
    }

    return await fetchFromBlockscoutV2(chain, `/smart-contracts`, query);
  },
});

/**
 * 17. getContractSource
 * Retrieve the source code of a verified contract.
 * Endpoint: GET /contracts/{address}/source-code
 */
export const getSmartContract = createTool({
  name: "getSmartContract",
  description: "Retrieve the source code, ABI and metadata a contract.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    return await fetchFromBlockscoutV2(chain, `/smart-contracts/${address}`);
  },
});

/**
 * /tokens ENDPOINTS
 * - GET /tokens/{token_address} => Get token data and state by provided contract address
 * - GET /tokens/{token_address}/holders => Get token holders
 * - GET /tokens/{token_address}/transfers => Get token transfers by provided contract address
 */

/**
 * 21. getTokenInfo
 * Fetch metadata for a token contract.
 * Endpoint: GET /tokens/{tokenContract}
 */
export const getTokenInfo = createTool({
  name: "getTokenInfo",
  description: "Fetch metadata for a token contract.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract } = args;
    return await fetchFromBlockscoutV2(chain, `/tokens/${tokenContract}`);
  },
});

/**
 * 22. getTokenHolders
 * Retrieve token holders and their balances for a token.
 * Endpoint: GET /tokens/{tokenContract}/holders
 */
export const getTokenHolders = createTool({
  name: "getTokenHolders",
  description: "Retrieve token holders and their balances for a given token.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
    page: z.number().optional(),
    offset: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, page, offset } = args;
    const query: Record<string, string> = {};
    if (page !== undefined) query["page"] = String(page);
    if (offset !== undefined) query["offset"] = String(offset);

    return await fetchFromBlockscoutV2(
      chain,
      `/tokens/${tokenContract}/holders`,
      query,
    );
  },
});

/**
 * 23. getTokenTransfers
 * List transfers for a specific token contract.
 * Endpoint: GET /tokens/{tokenContract}/transfers
 */
export const getTokenTransfers = createTool({
  name: "getTokenTransfers",
  description:
    "List transfers for a specific token contract with pagination support.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
    page: z.number().optional(),
    offset: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, page, offset } = args;
    const query: Record<string, string> = {};
    if (page !== undefined) query["page"] = String(page);
    if (offset !== undefined) query["offset"] = String(offset);
    return await fetchFromBlockscoutV2(
      chain,
      `/tokens/${tokenContract}/transfers`,
      query,
    );
  },
});

/**
 * /search ENDPOINTS
 * - GET /search => Get search results
 */
export const getBlockscoutSearch = createTool({
  name: "getBlockscoutSearch",
  description:
    "Perform a search query to find blocks, transactions, addresses, or tokens on the blockchain.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: z.number().describe("ChainID for searching data on"),
    query: z.string().min(1, "A non-empty search query is required"),
  }),
  execute: async (_, args) => {
    const { chain, query } = args;
    // Assuming the Blockscout v2 API exposes a search endpoint at `/search`
    // with the query passed as parameter 'q'. Adjust if your API differs.
    return await fetchFromBlockscoutV2(chain, `/search`, { q: query });
  },
});
