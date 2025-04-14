import { createTool } from "../client.js";
import { z } from "zod";

const BASE_URL = "https://blockstream.info/api";

export const getLatestBtcBlock = createTool({
  name: "getLatestBtcBlock",
  description: "Fetches the latest Bitcoin block details.",
  parameters: z.object({}),
  execute: async () => {
    const latestHashRes = await fetch(`${BASE_URL}/blocks`);
    if (!latestHashRes.ok) {
      throw new Error("Failed to fetch latest blocks.");
    }
    const blocks = await latestHashRes.json();
    return blocks[0];
  },
});

export const getBtcTxDetails = createTool({
  name: "getBtcTxDetails",
  description: "Fetches details for a given Bitcoin transaction ID (txid).",
  parameters: z.object({
    txid: z.string().describe("Transaction ID to fetch details for."),
  }),
  execute: async (_client, args) => {
    const { txid } = args;
    const res = await fetch(`${BASE_URL}/tx/${txid}`);
    if (!res.ok) {
      throw new Error("Failed to fetch transaction details.");
    }
    return await res.json();
  },
});

export const getBtcAddressInfo = createTool({
  name: "getBtcAddressInfo",
  description: "Fetches information about a Bitcoin address including balance and tx count.",
  parameters: z.object({
    address: z.string().describe("Bitcoin address to lookup."),
  }),
  execute: async (_client, args) => {
    const { address } = args;
    const res = await fetch(`${BASE_URL}/address/${address}`);
    if (!res.ok) {
      throw new Error("Failed to fetch address info.");
    }
    return await res.json();
  },
});
