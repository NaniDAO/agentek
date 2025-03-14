import { l2Tools } from "../src/shared/l2";
import { createAgentekClient } from "../src/shared/client";
import { http } from "viem";
import { arbitrum, optimism } from "viem/chains";

async function main() {
  try {
    // Create a client with the necessary providers
    const client = createAgentekClient({
      transports: [http(), http()],
      chains: [optimism, arbitrum],
      accountOrAddress: "0x0000000000000000000000000000000000000000",
      tools: [...l2Tools()],
    });

    // Example for getting L2 deposits on Optimism
    console.log("Fetching Optimism deposits...");
    const deposits = await client.execute("getL2Deposits", {
      chainId: optimism.id, // Optimism
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
      limit: 5,
    });
    
    console.log("L2 Deposits:", JSON.stringify(deposits, null, 2));
    
    // Example for getting L2 withdrawals on Arbitrum
    console.log("Fetching Arbitrum withdrawals...");
    const withdrawals = await client.execute("getL2Withdrawals", {
      chainId: arbitrum.id, // Arbitrum
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
      limit: 5,
    });
    
    console.log("L2 Withdrawals:", JSON.stringify(withdrawals, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);