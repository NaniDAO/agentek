import { gasEstimatorTools, resolveTransports } from "@agentek/tools";
import { createAgentekClient } from "@agentek/tools/client";
import { mainnet, arbitrum, optimism, polygon } from "viem/chains";
import { zeroAddress } from "viem";
const chains = [mainnet, arbitrum, optimism, polygon];
const client = createAgentekClient({
  chains, transports: resolveTransports(chains), tools: gasEstimatorTools(),
  accountOrAddress: zeroAddress, executionMode: "prepare",
});
async function main() {
  for (const chain of chains) {
    // Without transaction bytes, L2 posting fees can remain unknown. Inspect
    // coverage and totalFeeWei before treating a value as a complete estimate.
    const estimate = await client.execute("estimateGasCost", {chainId: chain.id, gasUnits: 21000});
    console.log(chain.name, JSON.stringify(estimate, null, 2));
  }
}
main().catch(console.error);
