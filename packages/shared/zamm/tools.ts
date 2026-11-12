import * as z from "zod";
import { createTool } from "../client.js";
import { zammFetch, zammGraphql } from "./constants.js";
import { formatEther } from "viem";
import { addressSchema } from "../utils.js";

const uint256Schema = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n, "Value exceeds uint256");
const blockSchema = z.string().max(20).regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) < 2n ** 64n, "Block exceeds uint64");
const swapParameters = z.object({
  poolId: uint256Schema.describe("The numeric pool ID as an exact decimal string"),
  startBlock: blockSchema.optional().describe("Optional inclusive start block"),
  endBlock: blockSchema.optional().describe("Optional inclusive end block"),
  limit: z.number().int().min(1).max(1000).default(50),
});

const providerInteger = z.union([uint256Schema, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]);
const requireAmounts = (value: unknown, fields: string[]): void => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      fields.some(field => !providerInteger.safeParse(value[field]).success)) {
    throw new Error("Unreadable ZAMM numeric response");
  }
};

// [✓] getCoin
export const getCoin = createTool({
  name: "getCoin",
  description:
    "Fetch metadata about a ZAMM coin by its ticker symbol, including name, total supply, image, and pool information.",
  parameters: z.object({
    symbol: z.string().min(1).max(128).describe("The coin ticker symbol (e.g. 'PEPE', 'DOGE'). Case-insensitive."),
  }),
  execute: async (_client, args) => {
    // fetch coin by symbol (case-insensitive match)
    const json = await zammFetch(
      `/api/resolve?ticker=${encodeURIComponent(args.symbol)}`,
    );
    const data = json?.data;
    if (!data) throw new Error(`No ZAMM coin found for ticker "${args.symbol}"`);

    requireAmounts(data, ["total_supply"]);
    if (!Array.isArray(data.pools) || data.pools.length > 1000) throw new Error("Unreadable ZAMM pool coverage");
    for (const pool of data.pools) {
      requireAmounts(pool, ["reserve0", "reserve1", "price0", "price1"]);
      if (!pool.otherToken || typeof pool.otherToken !== "object") throw new Error("Unreadable ZAMM pool token");
    }
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
    "Fetch the list of holders for a given ZAMM coin, ordered by balance descending.",
  parameters: z.object({
    coinId: uint256Schema.describe("The numeric coin ID as a decimal string (get this from getCoin)"),
    limit: z.number().int().min(1).max(100).default(50).describe("Number of holders to return (1-100, default 50)"),
    offset: z.number().int().min(0).max(1_000_000).default(0).describe("Offset for pagination (default 0)"),
  }),
  execute: async (_client, args) => {
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      coinId: args.coinId,
      limit: args.limit.toString(),
      offset: args.offset.toString(),
    });
    const json = await zammFetch(`/api/holders?${params}`);
    if (!Array.isArray(json?.data) || json.data.length > args.limit) throw new Error("Unreadable ZAMM holder coverage");
    return json.data;
  },
});


// getAccountPortfolio
export const getAccountPortfolio = createTool({
  name: "getAccountPortfolio",
  description:
    "Read ZAMM/indexer-specific holdings for an address, including coin metadata. This is not the wallet's complete portfolio or total balance.",
  parameters: z.object({
    address: addressSchema,
  }),
  execute: async (_client, args) => {
    // fetch all holders where address = args.address and join coin
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      address: args.address,
    });
    return await zammFetch(`/api/portfolio?${params}`);
  },
});

// getPool
export const getPool = createTool({
  name: "getPool",
  description:
    "Fetch the latest state of a ZAMM liquidity pool, including reserves, prices, swap fee, and token metadata.",
  parameters: z.object({
    poolId: uint256Schema.describe("The numeric pool ID as a decimal string"),
  }),
  execute: async (_client, args) => {
    uint256Schema.parse(args.poolId);
    const query = `
      query GetPool {
        pool(id: ${JSON.stringify(args.poolId)}) {
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

    const data = await zammGraphql(query);

    const pool = data?.pool;
    if (!pool) throw new Error(`ZAMM pool ${args.poolId} not found`);

    requireAmounts(pool, ["reserve0", "reserve1", "price0", "price1"]);
    if (!pool.coin0 || !pool.coin1) throw new Error("Unreadable ZAMM pool token coverage");
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
    "Fetch recent swap events for a given ZAMM pool, optionally filtered by block range.",
  parameters: swapParameters,
  execute: async (_client, args) => {
    const parsed = swapParameters.parse(args);
    if (parsed.startBlock && parsed.endBlock && BigInt(parsed.startBlock) > BigInt(parsed.endBlock)) throw new Error("Start block exceeds end block");
    // Preserve the deployed indexer's existing quoted scalar syntax. Every
    // value is a bounded canonical decimal before safe literal encoding, so
    // model input cannot alter this fixed query structure.
    const where = [
      `poolId: ${JSON.stringify(parsed.poolId)}`,
      ...(parsed.startBlock === undefined ? [] : [`blockNumber_gte: ${JSON.stringify(parsed.startBlock)}`]),
      ...(parsed.endBlock === undefined ? [] : [`blockNumber_lte: ${JSON.stringify(parsed.endBlock)}`]),
    ].join(", ");
    const query = `
      query GetSwaps {
        swaps(limit: ${parsed.limit}, where: {${where}}) {
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

    const data = await zammGraphql(query);

    // Transform the data to flatten coin symbol information
    if (!Array.isArray(data?.swaps?.items) || data.swaps.items.length > parsed.limit) throw new Error("Unreadable ZAMM swap coverage");
    for (const swap of data.swaps.items) {
      requireAmounts(swap, ["amount0In", "amount0Out", "amount1In", "amount1Out", "blockNumber"]);
      if (!swap.pool?.coin0 || !swap.pool?.coin1) throw new Error("Unreadable ZAMM swap token coverage");
    }
    const swaps = data.swaps.items.map((swap: any) => ({
      ...swap,
      coin0Symbol: swap.pool.coin0.symbol,
      coin1Symbol: swap.pool.coin1.symbol,
      swapFee: swap.pool.swapFee,
      pool: undefined, // Remove the nested pool object
    }));

    return swaps;
  },
});
