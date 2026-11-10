import { defillamaTools, resolveTransports } from "@agentek/tools";
import { createAgentekClient } from "@agentek/tools/client";
import { mainnet } from "viem/chains";
import { zeroAddress } from "viem";

const client = createAgentekClient({
  chains: [mainnet], transports: resolveTransports([mainnet]),
  accountOrAddress: zeroAddress, tools: defillamaTools(), executionMode: "prepare",
});

async function main() {
  // A listing is a research candidate; the result preserves verification gaps.
  const candidates = await client.execute("getYieldTool", {
    chainId: 1, asset: "USDC", stablecoin: true, limit: 5,
  });
  console.table(candidates.yields);
  if (candidates.yields.length) {
    const history = await client.execute("getYieldHistoryTool", {
      chainId: 1, poolId: candidates.yields[0].pool, days: 30,
    });
    console.log({averageApy: history.averageApy, volatility: history.volatility,
      firstObservation: history.firstObservation, lastObservation: history.lastObservation, warnings: history.warnings});
    console.table(history.timeline.slice(-5));
  }
  const comparison = await client.execute("compareYieldTool", {chainId: 1, assets: ["USDC", "ETH"]});
  console.log(JSON.stringify(comparison, null, 2));
}
main().catch(console.error);
