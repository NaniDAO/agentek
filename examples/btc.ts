import { createAgentekClient } from "../packages/shared/client";
import { btcRpcTools } from "../packages/shared/btc-rpc";
import { mainnet } from "viem/chains";
import { http } from "viem";

async function main() {
  // Create the client with BTC RPC tools
  const client = createAgentekClient({
    transports: [http()],
    chains: [mainnet],
    accountOrAddress: "0x0000000000000000000000000000000000000000",
    tools: [...btcRpcTools()],
  });

  try {
    // Get latest Bitcoin block
    const latestBlock = await client.execute("getLatestBtcBlock", {});
    console.log("Latest Bitcoin block:", latestBlock);

    // Get transaction details
    const txDetails = await client.execute("getBtcTxDetails", {
      txid: "721684cea52c6a9a991255b849dbc73a053c32990d0dff88e0c5d86c549fdfda",
    });
    console.log("Transaction details:", txDetails);

    // Get address info
    const addressInfo = await client.execute("getBtcAddressInfo", {
      address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    });
    console.log("Address info:", addressInfo);
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
