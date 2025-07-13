import { z } from "zod";
import { createTool } from "../client.js";
import { ZAMM_API } from "./constants.js";
import { mainnet } from "viem/chains";
import { formatEther } from "viem";
import { addressSchema } from "../utils.js";

// [✓] getCoin
export const getCoin = createTool({
  name: "getCoin",
  description:
    "Given a coin symbol, fetch the metadata about a coin (name, symbol, total supply, image, pools).",
  parameters: z.object({
    symbol: z.string(),
  }),
  execute: async (_client, args) => {
    // fetch coin by symbol (case-insensitive match)
    const res = await fetch(ZAMM_API + `/api/resolve?ticker=${args.symbol}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to fetch coin");
    const data = json.data;

    return {
      ...data,
      total_supply: formatEther(BigInt(data.total_supply)),
      pools: data.pools.map((pool) => ({
        ...pool,
        reserve0: formatEther(BigInt(pool.reserve0)),
        reserve1: formatEther(BigInt(pool.reserve1)),
        price0: formatEther(BigInt(pool.price0)),
        price1: formatEther(BigInt(pool.price1)),
        otherToken: {
          id: pool.otherToken.id == null ? "0" : pool.otherToken.id,
          symbol: pool.otherToken.symbol == null ? "ETH" : pool.otherToken.symbol,
        }
      })),
    };
  },
});


// getHolders
export const getHolders = createTool({
  name: "getHolders",
  description:
    "Fetch the list of holders for a given coin, ordered by balance descending by default.",
  parameters: z.object({
    coinId: z.string(), // Use string to support bigint
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  execute: async (_client, args) => {
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      coinId: args.coinId,
      limit: args.limit.toString(),
      offset: args.offset.toString(),
    });
    const res = await fetch(`/api/holders?${params}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to fetch holders");
    return json.data;
  },
});


// getAccountPortfolio
export const getAccountPortfolio = createTool({
  name: "getAccountPortfolio",
  description:
    "Given a wallet address, return all token balances the account holds, including coin metadata.",
  parameters: z.object({
    address: addressSchema,
  }),
  execute: async (_client, args) => {
    // fetch all holders where address = args.address and join coin
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      address: args.address,
    });
    const res = await fetch(`/api/portfolio?${params}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to fetch holders");
    return json.data;
  },
});

// getPool
export const getPool = createTool({
  name: "getPool",
  description:
    "Fetch the latest state of a pool, including reserves and price information.",
  parameters: z.object({
    poolId: z.string(), // bigint-safe
  }),
  execute: async (_client, args) => {
    const query = `
      query GetPool {
        pool(id: "${args.poolId}") {
          id
          reserve0
          reserve1
          price0
          price1
          swapFee
          coin0 {
            id
            symbol
            name
            image
          }
          coin1 {
            id
            symbol
            name
            image
          }
        }
      }
    `;

    const res = await fetch(ZAMM_API + '/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to fetch pool");

    const pool = json.data.pool;
    if (!pool) throw new Error("Pool not found");

    // Flatten the response
    return {
      id: pool.id,
      reserve0: formatEther(BigInt(pool.reserve0)),
      reserve1: formatEther(BigInt(pool.reserve1)),
      price0: formatEther(BigInt(pool.price0)),
      price1: formatEther(BigInt(pool.price1)),
      swapFee: pool.swapFee,
      coin0Id: pool.coin0.id,
      coin0Symbol: pool.coin0.symbol,
      coin0Name: pool.coin0.name,
      coin0Image: pool.coin0.image,
      coin1Id: pool.coin1.id,
      coin1Symbol: pool.coin1.symbol,
      coin1Name: pool.coin1.name,
      coin1Image: pool.coin1.image,
    };
  },
});


// getSwaps
export const getSwaps = createTool({
  name: "getSwaps",
  description:
    "Fetch recent swap events for a given pool, optionally filtered by block range.",
  parameters: z.object({
    poolId: z.string(),
    startBlock: z.string().optional(),
    endBlock: z.string().optional(),
    limit: z.number().int().min(1).max(1000).default(50),
  }),
  execute: async (_client, args) => {
    // Build the where clause conditionally
    let whereClause = `poolId: "${args.poolId}"`;
    if (args.startBlock) {
      whereClause += `, blockNumber_gte: "${args.startBlock}"`;
    }
    if (args.endBlock) {
      whereClause += `, blockNumber_lte: "${args.endBlock}"`;
    }

    const whereArgument = whereClause ? `, where: {${whereClause}}` : '';

    const query = `
      query GetSwaps {
        swaps(limit: ${args.limit}${whereArgument}) {
          items {
            amount0In
            amount0Out
            amount1Out
            amount1In
            blockNumber
            id
            poolId
            source
            timestamp
            toAddr
            trader
            txHash
            pool {
              swapFee
              coin1 {
                symbol
              }
              coin0 {
                symbol
              }
            }
          }
        }
      }
    `;

    const res = await fetch(ZAMM_API + '/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to fetch swaps");

    // Transform the data to flatten coin symbol information
    const swaps = json.data.swaps.items.map((swap) => ({
      ...swap,
      coin0Symbol: swap.pool.coin0.symbol,
      coin1Symbol: swap.pool.coin1.symbol,
      swapFee: swap.pool.swapFee,
      pool: undefined, // Remove the nested pool object
    }));

    return swaps;
  },
});
