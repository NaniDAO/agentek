import type { BaseTool } from "../client.js";
import { btcRpcTools } from "../btc-rpc/index.js";

/** Native Bitcoin observations without pulling Solana tools into the bundle. */
export function bitcoinReadOnlyTools(): BaseTool[] {
  return btcRpcTools().map(tool => ({
    ...tool,
    description: tool.description + " Read-only Bitcoin mainnet lookup. Requires an explicit Bitcoin address where applicable; never use an EVM address.",
    execute: async (client, args) => {
      const request = tool.parameters.parse(args);
      for (const field of ["blockHash", "txid"]) {
        if (request[field] !== undefined && !/^[a-fA-F0-9]{64}$/.test(request[field])) {
          throw new Error(`Invalid Bitcoin ${field}: supply exactly 64 hexadecimal characters.`);
        }
      }
      if (request.address !== undefined && !/^(?:[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/.test(request.address)) {
        throw new Error("Supply a Bitcoin mainnet address. Testnet and EVM addresses are not supported here.");
      }
      return {schemaVersion: 1, tool: tool.name, network: "bitcoin", cluster: "mainnet", request,
        observedAt: new Date().toISOString(), result: await tool.execute(client, request)};
    },
  }));
}
