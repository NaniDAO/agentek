import { createAgentekClient } from "../packages/shared/client";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { nftTools } from "../packages/shared/erc721";

async function main() {
  // Example NFT: CryptoPunk #7804
  const contractAddress = "0x5af0d9827e0c53e4799bb226655a1de152a425a5";
  const tokenId = "3734";

  const client = createAgentekClient({
    transports: [http()],
    chains: [mainnet],
    accountOrAddress: "0x0000000000000000000000000000000000000000",
    tools: [...nftTools()],
  });

  try {
    const nftMetadata = await client.execute("getNFTMetadata", {
      contractAddress,
      tokenId,
      chainId: mainnet.id,
    });

    console.log("NFT Metadata:");
    console.log(JSON.stringify(nftMetadata, null, 2));
  } catch (error) {
    console.error("Error fetching NFT metadata:", error);
  }
}

main().catch(console.error);
