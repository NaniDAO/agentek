import { Hex, http } from "viem";
import { mainnet, arbitrum, optimism, polygon } from "viem/chains";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { rpcTools } from "../packages/shared/rpc";
import { gasEstimatorTools } from "../packages/shared/gasestimator";
import { cryptoPriceTools } from "../packages/shared/cryptoprices";
import { estimateGasCostTool } from "../packages/shared/gasestimator/tools";

async function main() {
  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.log("PRIVATE_KEY:", privateKey);
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [mainnet, arbitrum, optimism, polygon];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.name),
  );

  const toolkit = new AgentekToolkit({
    transports: [http(), http(), http(), http()],
    chains,
    accountOrAddress: account,
    tools: [...rpcTools(), ...gasEstimatorTools(), ...cryptoPriceTools()],
  });

  // Standard ETH transfer gas amount
  const standardGasUnits = 21000;

  console.log("\n=== Gas Cost Estimates for ETH Transfers ===\n");

  // Get access to the tools
  const tools = toolkit.getTools();

  // Estimate gas costs for each chain
  const estimates = await Promise.all([
    tools.estimateGasCost.execute({ chainId: 1, gasUnits: standardGasUnits }),
    tools.estimateGasCost.execute({ chainId: 137, gasUnits: standardGasUnits }),
    tools.estimateGasCost.execute({
      chainId: 42161,
      gasUnits: standardGasUnits,
    }),
    tools.estimateGasCost.execute({ chainId: 10, gasUnits: standardGasUnits }),
  ]);

  // Display results in a formatted table
  console.log("| Network   | Gas (Gwei) | Native Cost        | USD Cost    |");
  console.log("|-----------|------------|--------------------| ------------|");

  for (const estimate of estimates) {
    console.log(
      `| ${getNetworkName(estimate.chainId).padEnd(9)} | ` +
        `${estimate.maxFeePerGas.padEnd(10)} | ` +
        `${estimate.totalCost} ${estimate.nativeSymbol.padEnd(7)} | ` +
        `$${estimate.usdCost || "N/A"} |`,
    );
  }

  console.log(
    "\nNote: Gas costs are estimates and may change with network conditions",
  );
}

// Helper function to get network name from chain ID
function getNetworkName(chainId: number): string {
  const networks: Record<number, string> = {
    1: "Ethereum",
    137: "Polygon",
    42161: "Arbitrum",
    10: "Optimism",
  };

  return networks[chainId] || `Chain ${chainId}`;
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
