import { describe, it, expect } from "vitest";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";
import {
  getNativeCoinHolders,
  getAddressInfo,
  getAddressCounters,
  getAddressTransactions,
  getAddressTokenTransfers,
  getAddressInternalTransactions,
  getAddressLogs,
  getAddressBlocksValidated,
  getAddressTokenBalances,
  getAddressTokens,
  getAddressCoinBalanceHistory,
  getAddressCoinBalanceHistoryByDay,
  getAddressWithdrawals,
  getAddressNFTs,
  getAddressNFTCollections,
  getBlockInfo,
  getBlockTransactions,
  getBlockWithdrawals,
  getStats,
  getTransactionsChart,
  getTransactionInfo,
  getTransactionTokenTransfers,
  getTransactionInternalTransactions,
  getTransactionLogs,
  getTransactionRawTrace,
  getTransactionStateChanges,
  getTransactionSummary,
  getSmartContracts,
  getSmartContract,
  getTokenInfo,
  getTokenHolders,
  getTokenTransfers,
  getBlockscoutSearch,
} from "./tools.js";
import { blockscoutTools } from "./index.js";
import {
  createTestClient,
  TEST_ADDRESSES,
  validateToolStructure,
  withRetry,
} from "../test-helpers.js";

// Create a test client with real Blockscout tools
const client = createTestClient(blockscoutTools());

// Well-known test data
const VITALIK_ADDRESS = TEST_ADDRESSES.vitalik;
const USDC_MAINNET = TEST_ADDRESSES.usdc.mainnet;
const WETH_MAINNET = TEST_ADDRESSES.weth.mainnet;

// A known mainnet transaction hash (Uniswap swap)
const KNOWN_TX_HASH = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

// A known mainnet block number
const KNOWN_BLOCK_NUMBER = 19000000;

// Timeout for API calls (Blockscout can be slow)
const API_TIMEOUT = 30000;

describe("Blockscout Tools - Real API Tests", () => {
  describe("Tool Structure", () => {
    it("should have valid tool structure for getAddressInfo", () => {
      const result = validateToolStructure(getAddressInfo);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should have valid tool structure for getBlockInfo", () => {
      const result = validateToolStructure(getBlockInfo);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should have valid tool structure for getTransactionInfo", () => {
      const result = validateToolStructure(getTransactionInfo);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should have valid tool structure for getTokenInfo", () => {
      const result = validateToolStructure(getTokenInfo);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("blockscoutTools() should return all tools", () => {
      const tools = blockscoutTools();
      expect(tools.length).toBeGreaterThan(20);
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("getAddressInfo");
      expect(toolNames).toContain("getBlockInfo");
      expect(toolNames).toContain("getTransactionInfo");
      expect(toolNames).toContain("getTokenInfo");
      expect(toolNames).toContain("getBlockscoutSearch");
    });
  });

  describe("Address Endpoints", () => {
    it("should get native coin holders", async () => {
      const result = await withRetry(() =>
        getNativeCoinHolders.execute(client, { chain: mainnet.id })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address info for Vitalik on mainnet", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(VITALIK_ADDRESS.toLowerCase());
      expect(result.coin_balance).toBeDefined();
      expect(result.coin_balance_raw).toBeDefined();
      // Vitalik has ETH
      expect(parseFloat(result.coin_balance)).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it("should get address info for USDC contract on mainnet", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: mainnet.id,
          address: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(USDC_MAINNET.toLowerCase());
      expect(result.is_contract).toBe(true);
    }, API_TIMEOUT);

    it("should get address counters for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressCounters.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      // Vitalik has many transactions
      expect(result.transactions_count).toBeDefined();
    }, API_TIMEOUT);

    it("should get address transactions for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressTransactions.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it("should get address token transfers for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressTokenTransfers.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address internal transactions for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressInternalTransactions.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address logs for USDC contract", async () => {
      const result = await withRetry(() =>
        getAddressLogs.execute(client, {
          chain: mainnet.id,
          address: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address token balances for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressTokenBalances.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    }, API_TIMEOUT);

    it("should get address tokens for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressTokens.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address coin balance history for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressCoinBalanceHistory.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address coin balance history by day for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressCoinBalanceHistoryByDay.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    }, API_TIMEOUT);

    it("should get address NFTs for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressNFTs.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get address NFT collections for Vitalik", async () => {
      const result = await withRetry(() =>
        getAddressNFTCollections.execute(client, {
          chain: mainnet.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);
  });

  describe("Block Endpoints", () => {
    it("should get block info by number", async () => {
      const result = await withRetry(() =>
        getBlockInfo.execute(client, {
          chain: mainnet.id,
          blockNumberOrHash: KNOWN_BLOCK_NUMBER,
        })
      );
      expect(result).toBeDefined();
      expect(result.height).toBe(KNOWN_BLOCK_NUMBER);
      expect(result.hash).toBeDefined();
      expect(result.timestamp).toBeDefined();
    }, API_TIMEOUT);

    it("should get block transactions", async () => {
      const result = await withRetry(() =>
        getBlockTransactions.execute(client, {
          chain: mainnet.id,
          blockNumberOrHash: KNOWN_BLOCK_NUMBER,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it("should get block withdrawals (post-Shanghai)", async () => {
      // Block 17034871 is the first block with withdrawals (Shanghai upgrade)
      const shanghaiBlock = 17034871;
      const result = await withRetry(() =>
        getBlockWithdrawals.execute(client, {
          chain: mainnet.id,
          blockNumberOrHash: shanghaiBlock,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);
  });

  describe("Stats Endpoints", () => {
    it("should get chain stats for mainnet", async () => {
      const result = await withRetry(() =>
        getStats.execute(client, { chain: mainnet.id })
      );
      expect(result).toBeDefined();
      expect(result.total_blocks).toBeDefined();
      expect(result.total_addresses).toBeDefined();
      expect(result.total_transactions).toBeDefined();
    }, API_TIMEOUT);

    it("should get chain stats for Base", async () => {
      const result = await withRetry(() =>
        getStats.execute(client, { chain: base.id })
      );
      expect(result).toBeDefined();
      expect(result.total_blocks).toBeDefined();
    }, API_TIMEOUT);

    it("should get transactions chart", async () => {
      const result = await withRetry(() =>
        getTransactionsChart.execute(client, { chain: mainnet.id })
      );
      expect(result).toBeDefined();
      expect(result.chart_data).toBeDefined();
      expect(Array.isArray(result.chart_data)).toBe(true);
    }, API_TIMEOUT);
  });

  describe("Transaction Endpoints", () => {
    it("should get transaction info", async () => {
      const result = await withRetry(() =>
        getTransactionInfo.execute(client, {
          chain: mainnet.id,
          txhash: KNOWN_TX_HASH,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(KNOWN_TX_HASH.toLowerCase());
      expect(result.block).toBeDefined();
      expect(result.status).toBeDefined();
    }, API_TIMEOUT);

    it("should get transaction token transfers", async () => {
      // Use a known swap transaction that has token transfers
      const swapTx = "0x2d4eb16c9df5ebc3e1c5a5ec9ea8e4ce1fc8dc44d2e8dd7fd10f5c9f4c17e6f5";
      const result = await withRetry(() =>
        getTransactionTokenTransfers.execute(client, {
          chain: mainnet.id,
          txhash: swapTx,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get transaction internal transactions", async () => {
      const result = await withRetry(() =>
        getTransactionInternalTransactions.execute(client, {
          chain: mainnet.id,
          txhash: KNOWN_TX_HASH,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get transaction logs", async () => {
      const result = await withRetry(() =>
        getTransactionLogs.execute(client, {
          chain: mainnet.id,
          txhash: KNOWN_TX_HASH,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get transaction raw trace", async () => {
      const result = await withRetry(() =>
        getTransactionRawTrace.execute(client, {
          chain: mainnet.id,
          txhash: KNOWN_TX_HASH,
        })
      );
      expect(result).toBeDefined();
    }, API_TIMEOUT);

    it("should get transaction state changes", async () => {
      const result = await withRetry(() =>
        getTransactionStateChanges.execute(client, {
          chain: mainnet.id,
          txhash: KNOWN_TX_HASH,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);
  });

  describe("Smart Contract Endpoints", () => {
    it("should search for smart contracts", async () => {
      const result = await withRetry(() =>
        getSmartContracts.execute(client, {
          chain: mainnet.id,
          q: "USDC",
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should get smart contract info for USDC", async () => {
      const result = await withRetry(() =>
        getSmartContract.execute(client, {
          chain: mainnet.id,
          address: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.is_verified).toBeDefined();
      expect(result.name).toBeDefined();
    }, API_TIMEOUT);

    it("should get smart contract info for WETH", async () => {
      const result = await withRetry(() =>
        getSmartContract.execute(client, {
          chain: mainnet.id,
          address: WETH_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.is_verified).toBeDefined();
    }, API_TIMEOUT);
  });

  describe("Token Endpoints", () => {
    it("should get token info for USDC", async () => {
      const result = await withRetry(() =>
        getTokenInfo.execute(client, {
          chain: mainnet.id,
          tokenContract: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.name).toBeDefined();
      expect(result.symbol).toBeDefined();
      expect(result.decimals).toBeDefined();
      expect(result.symbol).toBe("USDC");
      expect(result.decimals).toBe("6");
    }, API_TIMEOUT);

    it("should get token info for WETH", async () => {
      const result = await withRetry(() =>
        getTokenInfo.execute(client, {
          chain: mainnet.id,
          tokenContract: WETH_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.symbol).toBe("WETH");
      expect(result.decimals).toBe("18");
    }, API_TIMEOUT);

    it("should get token holders for USDC", async () => {
      const result = await withRetry(() =>
        getTokenHolders.execute(client, {
          chain: mainnet.id,
          tokenContract: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it("should get token transfers for USDC", async () => {
      const result = await withRetry(() =>
        getTokenTransfers.execute(client, {
          chain: mainnet.id,
          tokenContract: USDC_MAINNET,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    }, API_TIMEOUT);
  });

  describe("Search Endpoint", () => {
    it("should search for Vitalik address", async () => {
      const result = await withRetry(() =>
        getBlockscoutSearch.execute(client, {
          chain: mainnet.id,
          query: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);

    it("should search for USDC", async () => {
      const result = await withRetry(() =>
        getBlockscoutSearch.execute(client, {
          chain: mainnet.id,
          query: "USDC",
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    }, API_TIMEOUT);

    it("should search for a block number", async () => {
      const result = await withRetry(() =>
        getBlockscoutSearch.execute(client, {
          chain: mainnet.id,
          query: String(KNOWN_BLOCK_NUMBER),
        })
      );
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    }, API_TIMEOUT);
  });

  describe("Multi-chain Support", () => {
    it("should get address info on Base", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: base.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(VITALIK_ADDRESS.toLowerCase());
    }, API_TIMEOUT);

    it("should get address info on Arbitrum", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: arbitrum.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(VITALIK_ADDRESS.toLowerCase());
    }, API_TIMEOUT);

    it("should get address info on Optimism", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: optimism.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(VITALIK_ADDRESS.toLowerCase());
    }, API_TIMEOUT);

    it("should get address info on Polygon", async () => {
      const result = await withRetry(() =>
        getAddressInfo.execute(client, {
          chain: polygon.id,
          address: VITALIK_ADDRESS,
        })
      );
      expect(result).toBeDefined();
      expect(result.hash?.toLowerCase()).toBe(VITALIK_ADDRESS.toLowerCase());
    }, API_TIMEOUT);

    it("should get stats on multiple chains", async () => {
      const chains = [mainnet.id, base.id, arbitrum.id];

      for (const chainId of chains) {
        const result = await withRetry(() =>
          getStats.execute(client, { chain: chainId })
        );
        expect(result).toBeDefined();
        expect(result.total_blocks).toBeDefined();
      }
    }, API_TIMEOUT * 3);
  });

  describe("Error Handling", () => {
    it("should handle invalid address format", async () => {
      await expect(
        getAddressInfo.execute(client, {
          chain: mainnet.id,
          address: "invalid-address",
        })
      ).rejects.toThrow();
    });

    it("should handle non-existent transaction hash", async () => {
      const fakeTxHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
      await expect(
        getTransactionInfo.execute(client, {
          chain: mainnet.id,
          txhash: fakeTxHash,
        })
      ).rejects.toThrow();
    }, API_TIMEOUT);
  });
});
