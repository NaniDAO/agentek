import { providerJSON } from "../utils/fetch.js";
import { createTool } from "../client.js";
import * as z from "zod";

const BASE_URL = "https://blockstream.info/api";

export const getLatestBtcBlock = createTool({
  name: "getLatestBtcBlock",
  description: "Fetches the latest Bitcoin block details.",
  parameters: z.object({}),
  execute: async () => {
    const blocks = await providerJSON(`${BASE_URL}/blocks`, {}, "Failed to fetch latest blocks", {maximumBytes: 1024 * 1024});
    if (!Array.isArray(blocks) || !blocks[0] || typeof blocks[0] !== "object") throw new Error("Malformed Bitcoin block response");
    return blocks[0];
  },
});

export const getBlockTxids = createTool({
  name: "getBtcBlockTxids",
  description: "Returns a list of transaction IDs in a block, given the block hash.",
  parameters: z.object({
    blockHash: z.string().describe("Block hash to fetch txids from"),
  }),
  execute: async (_client, args) => {
    const txids = await providerJSON(`${BASE_URL}/block/${encodeURIComponent(args.blockHash)}/txids`, {}, "Failed to fetch txids from block");
    if (!Array.isArray(txids) || txids.some(txid => typeof txid !== "string" || !/^[a-fA-F0-9]{64}$/.test(txid))) throw new Error("Malformed Bitcoin transaction ID response");
    return { txids };
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
    return providerJSON(`${BASE_URL}/tx/${encodeURIComponent(txid)}`, {}, "Failed to fetch transaction details");
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
    return providerJSON(`${BASE_URL}/address/${encodeURIComponent(address)}`, {}, "Failed to fetch address info");
  },
});
