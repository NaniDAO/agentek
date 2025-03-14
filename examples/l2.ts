import { l2Tools } from "../src/shared/l2";
import { createAgentekClient } from "../src/shared/client";
import { http } from "viem";
import { arbitrum, optimism } from "viem/chains";

async function main() {
  // Example for getting L2 deposits
   const client = createAgentekClient({
      transports: [http(),http()],
      chains: [optimism, arbitrum],
      accountOrAddress: "0x0000000000000000000000000000000000000000",
      tools: [...l2Tools()],
    });

  const deposits = await client.execute("getL2Deposits",{
    chainId: 10, // Optimism
    address: "0x0000000000000000000000000000000000000000",
    limit: 5,
  });
  
  console.log("L2 Deposits:", JSON.stringify(deposits, null, 2));
  
  // Example for getting L2 withdrawals
  const withdrawals = await client.execute("getL2Withdrawals",{
    chainId: 42161, // Optimism
    address: "0x0000000000000000000000000000000000000000",
    limit: 5,
  });
  
  console.log("L2 Withdrawals:", JSON.stringify(withdrawals, null, 2));
}

main().catch(console.error);