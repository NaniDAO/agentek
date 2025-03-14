import { createAgentekClient } from "../src/shared/client";
import { cryptoPriceTools } from "../src/shared/cryptoprices";
import { mainnet } from "viem/chains";
import { http } from "viem";

async function main() {
  // Create the client with crypto price tools
  const client = createAgentekClient({
      transports: [http()],
      chains: [mainnet],
      accountOrAddress: "0x0000000000000000000000000000000000000000",
      tools: [...cryptoPriceTools()],
  });

  try {
    // Get Bitcoin price
    const btcResult = await client.execute("getCryptoPrice", {
      symbol: "BTC"
    });
    console.log(`Bitcoin price: $${btcResult.price.toLocaleString()} USD`);

    // Get Ethereum price
    const ethResult = await client.execute("getCryptoPrice",{
      symbol: "ETH"
    });
    console.log(`Ethereum price: $${ethResult.price.toLocaleString()} USD`);
    
    // Get Solana price
    const solResult = await client.execute("getCryptoPrice", {
      symbol: "SOL"
    });
    console.log(`Solana price: $${solResult.price.toLocaleString()} USD`);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);