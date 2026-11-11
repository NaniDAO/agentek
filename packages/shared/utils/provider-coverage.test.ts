import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentekClient } from "../client.js";
import { researchPage } from "../blockscout/research.js";
import { fetchFromBlockscoutV2 } from "../blockscout/tools.js";
import { readContractTool } from "../contract/tools.js";
import { fearGreedIndexTool } from "../feargreed/tools.js";
import { getCryptoPriceTool } from "../cryptoprices/tools.js";
import { getLatestBtcBlock, getBlockTxids, getBtcTxDetails, getBtcAddressInfo } from "../btc-rpc/tools.js";
import { providerJSON } from "./fetch.js";

const address = `0x${"1".repeat(40)}`;
const client = {} as AgentekClient;
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});
const readers = [
  ["research", () => researchPage("getAddressTokenTransfers", "transfers", {chain: 1, address}, "https://eth.blockscout.com/api/v2", `/addresses/${address}/token-transfers`), 20_000],
  ["legacy", () => fetchFromBlockscoutV2(1, `/addresses/${address}/logs`), 30_000],
] as const;

describe("Blockscout bounded evidence transport", () => {
  it.each(readers)("preserves HTTP retry semantics in %s reads", async (_name, read) => {
    for (const [status, retryable] of [[400, false], [429, true], [503, true]] as const) {
      vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
        expect(init.redirect).toBe("error");
        return new Response("private upstream diagnostic", {status});
      }));
      await expect(read()).rejects.toMatchObject({category: "upstream_http", retryable});
    }
  });

  it.each(readers)("rejects malformed JSON as unreadable evidence in %s reads", async (_name, read) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream diagnostic")));
    await expect(read()).rejects.toMatchObject({category: "malformed_response", retryable: false});
  });

  it.each(readers)("keeps the full fetch/body deadline and cancels stalled %s reads", async (_name, read, timeout) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let signal: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({cancel}));
    }));
    const pending = expect(read()).rejects.toMatchObject({category: "timeout", retryable: true});
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(readers)("cancels oversized %s pages before parsing", async (_name, read) => {
    const cancel = vi.fn(); let chunks = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {if (chunks++ < 5) controller.enqueue(new Uint8Array(1024 * 1024));}, cancel,
    }))));
    await expect(read()).rejects.toMatchObject({category: "malformed_response", retryable: false});
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("fixed provider compatibility", () => {
  it("keeps legacy non-OK ABI fallback without hiding malformed successful responses", async () => {
    const abi = [{type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{type: "string"}]}];
    const read = vi.fn(async () => "COIN");
    const rpcClient = {getPublicClient: () => ({readContract: read})} as unknown as AgentekClient;
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      return calls++ === 0 ? json({abi, implementations: [{address_hash: `0x${"2".repeat(40)}`}]}) : new Response("private-provider-key", {status: 404});
    }));
    await expect(readContractTool.execute(rpcClient, {address, chainId: 1, functionName: "symbol"})).resolves.toBe("COIN");
    expect(read.mock.calls[0][0].abi).toEqual(abi);
    read.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-provider-key")));
    await expect(readContractTool.execute(rpcClient, {address, chainId: 1, functionName: "symbol"})).rejects.toThrow(/^Blockscout ABI request failed: invalid JSON response$/);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps price, sentiment and Bitcoin response formats through pinned bounded requests", async () => {
    const txid = "a".repeat(64);
    const fixtures = [
      {data: [{value: "42", value_classification: "Fear"}]}, {bitcoin: {usd: 100}},
      [{id: txid, height: 1}], [txid], {txid, fee: 10}, {address: "bc1fixture", chain_stats: {tx_count: 2}},
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error"); expect(init.signal).toBeInstanceOf(AbortSignal);
      return json(fixtures.shift());
    }));
    await expect(fearGreedIndexTool.execute(client, {})).resolves.toMatchObject({value: "42"});
    await expect(getCryptoPriceTool.execute(client, {symbol: "BTC"})).resolves.toMatchObject({price: 100, currency: "USD"});
    await expect(getLatestBtcBlock.execute(client, {})).resolves.toMatchObject({id: txid, height: 1});
    await expect(getBlockTxids.execute(client, {blockHash: txid})).resolves.toEqual({txids: [txid]});
    await expect(getBtcTxDetails.execute(client, {txid})).resolves.toMatchObject({fee: 10});
    await expect(getBtcAddressInfo.execute(client, {address: "bc1fixture"})).resolves.toMatchObject({chain_stats: {tx_count: 2}});
    expect(fixtures).toEqual([]);
  });

  it("provides safe status metadata without retaining raw provider diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-provider-key", {status: 429})));
    await expect(providerJSON("https://provider.example/?key=private-provider-key", {}, "Lookup failed")).rejects.toMatchObject({name: "ProviderRequestError", message: "Lookup failed: HTTP 429", category: "upstream_http", status: 429, retryable: true});
  });
});
