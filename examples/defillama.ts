import {
  getYieldTool,
  compareYieldTool,
  getYieldHistoryTool,
  compareYieldHistoryTool,
  getTokenChartTool,
} from "../packages/shared/defillama/tools";

// Example 1: Get top yield opportunities across all protocols
async function example1() {
  console.log("Example 1: Top 5 yield opportunities across all protocols");
  const result = await getYieldTool.execute(null, {
    limit: 5,
  });
  console.table(result.yields);
}

// Example 2: Get yields filtered by asset type with minimum APY
async function example2() {
  console.log("Example 2: USDC yields with at least = 3% APY");
  const result = await getYieldTool.execute(null, {
    asset: "USDC",
    minApy: 3,
  });
  console.table(result.yields);
}

// Example 3: Get low-risk yield opportunities only
async function example3() {
  console.log("Example 3: Low-risk yield opportunities only");
  const result = await getYieldTool.execute(null, {
    maxRisk: "low",
    limit: 5,
  });
  console.table(result.yields);
}

// Example 4: Compare yields across multiple assets
async function example4() {
  console.log(
    "Example 4: Compare yields for USDC, ETH and WBTC with 30-day projections",
  );
  const result = await compareYieldTool.execute(null, {
    assets: ["USDC", "ETH", "WBTC"],
    amount: 10000,
    duration: 30,
  });

  console.log("Investment: $10,000 for 30 days\n");

  result.comparisons.forEach((comparison) => {
    console.log(`Asset: ${comparison.asset}`);
    console.table(comparison.protocols);
    console.log("\n");
  });
}

// Example 5: Get top stablecoin yield opportunities using DefiLlama
async function example5() {
  console.log("Example 5: Top 5 stablecoin yield opportunities from DefiLlama");
  const result = await getYieldTool.execute(null, {
    stablecoin: true,
    minApy: 5,
    limit: 5,
  });
  console.table(result.yields);
}

// Example 6: Get Ethereum-specific yields from DefiLlama
async function example6() {
  console.log("Example 6: Top Ethereum yields from DefiLlama");
  const result = await getYieldTool.execute(null, {
    chain: "Ethereum",
    limit: 5,
  });
  console.table(result.yields);
}

// Example 7: Get historical yield data for a specific pool
async function example7() {
  console.log("Example 7: Historical yield data for a specific pool");
  // First get a pool ID from the pools API
  const poolsResult = await getYieldTool.execute(null, {
    project: "Aave",
    symbol: "USDC",
    limit: 1,
  });

  if (poolsResult.yields.length === 0) {
    console.log("No pools found matching the criteria");
    return;
  }

  // Extract the pool ID from the first result
  const poolId = poolsResult.yields[0].pool;
  console.log(`Using pool ID: ${poolId}`);

  // Now fetch the historical data
  const result = await getYieldHistoryTool.execute(null, {
    poolId,
    days: 30,
  });

  console.log(`Pool ID: ${result.poolId}`);
  console.log(`Period: ${result.period}`);
  console.log(`Data points: ${result.dataPoints}`);

  console.log("\nCurrent:");
  console.table(result.current);

  console.log("\nStatistics:");
  console.log("APY:");
  console.table(result.statistics.apy);
  console.log("TVL:");
  console.table(result.statistics.tvl);

  console.log("\nTimeline (first 5 entries):");
  console.table(result.timeline.slice(0, 5));
}

// Example 8: Compare historical yield data for multiple pools
async function example8() {
  console.log("Example 8: Compare historical yield data across multiple pools");

  // First get some pool IDs from the pools API
  const stablecoinPools = await getYieldTool.execute(null, {
    stablecoin: true,
    minApy: 3,
    limit: 3,
  });

  if (stablecoinPools.yields.length < 2) {
    console.log("Not enough pools found for comparison");
    return;
  }

  // Extract pool IDs for comparison
  const poolIds = stablecoinPools.yields.map((pool) => pool.pool);
  console.log(`Comparing ${poolIds.length} pools: ${poolIds.join(", ")}`);

  // Now compare their historical performance
  const result = await compareYieldHistoryTool.execute(null, {
    poolIds,
    days: 60,
    sortBy: "stability",
  });

  console.log(`Period: ${result.period}`);
  console.log(`Sorted by: ${result.sortedBy}`);
  console.log(`Pools analyzed: ${result.count}`);

  console.log("\nBest for:");
  console.table(result.bestFor);

  console.log("\nPool Comparison:");
  console.table(result.pools);

  console.log("\nDetailed Results (first pool):");
  console.table(result.details[0]);
}
// Example 9: Get token price chart data
async function example9() {
  console.log("Example 9: Get price chart data for multiple tokens");

  const result: TokenChartResult = await getTokenChartTool.execute(null, {
    tokens: ["coingecko:bitcoin", "coingecko:ethereum"],
    period: "1h",
  });

  console.log("result", result);

  console.log(`Tokens: ${result.tokens.join(", ")}`);
  console.log(`Period: ${result.period}`);

  console.log("\nFirst 5 data points:");
  console.table(
    Object.keys(result.coins).map((coin) =>
      result.coins[coin].prices.slice(0, 5).map((price) => ({
        price: price.price,
        timestamp: price.timestamp,
      })),
    )[0],
  );
}

async function runExamples() {
  try {
    await example1();
    console.log("\n");

    await example2();
    console.log("\n");

    await example3();
    console.log("\n");

    await example4();
    console.log("\n");

    await example5();
    console.log("\n");

    await example6();
    console.log("\n");

    await example7();
    console.log("\n");

    await example8();
    console.log("\n");

    await example9();
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

runExamples();
