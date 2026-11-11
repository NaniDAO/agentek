import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentekClient } from "../client.js";
import { getHolders, getPool, getSwaps } from "./tools.js";
import { zammGraphql } from "./constants.js";
const client = {} as AgentekClient;
const coin = {id: "1", symbol: "COIN", name: "Coin", image: null};
const pool = {id: "42", reserve0: "1000000000000000000", reserve1: "2000000000000000000", price0: "2000000000000000000", price1: "500000000000000000", swapFee: "30", coin0: coin, coin1: {...coin, id: "2"}};
afterEach(() => vi.unstubAllGlobals());

describe("ZAMM query boundaries", () => {
  it.each(['42") { id } } alias: pools { items { id } } #', "-1", "1e18", "01", "1.0", (2n ** 256n).toString()])("rejects invalid or injected pool IDs %s", async poolId => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getPool.execute(client, {poolId})).rejects.toThrow();
    await expect(getSwaps.execute(client, {poolId})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves a full uint256 pool ID with the deployed quoted scalar syntax", async () => {
    const poolId = (2n ** 256n - 1n).toString();
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.variables).toBeUndefined();
      expect(body.query).toContain(`pool(id: "${poolId}")`);
      expect(body.query).not.toContain("BigInt");
      expect(init.redirect).toBe("error");
      return new Response(JSON.stringify({data: {pool}, errors: []}));
    }));
    await expect(getPool.execute(client, {poolId})).resolves.toMatchObject({reserve0: "1", reserve1: "2", coin0Symbol: "COIN", coin1Id: "2"});
  });

  it("preserves exact quoted block bounds beyond Number precision", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body.variables).toBeUndefined();
      expect(body.query).toContain('swaps(limit: 2, where: {poolId: "42", blockNumber_gte: "9007199254740993", blockNumber_lte: "9007199254740994"})');
      expect(body.query).not.toContain("BigInt");
      return new Response(JSON.stringify({data: {swaps: {items: [{amount0In: "1", amount0Out: "0", amount1In: "0", amount1Out: "2", blockNumber: "9007199254740993", pool}]}}}));
    }));
    await expect(getSwaps.execute(client, {poolId: "42", startBlock: "9007199254740993", endBlock: "9007199254740994", limit: 2})).resolves.toMatchObject([{coin0Symbol: "COIN", swapFee: "30"}]);
  });

  it.each([{startBlock: "10", endBlock: "9"}, {startBlock: '1") { id } #'}, {endBlock: (2n ** 64n).toString()}, {limit: 1001}])("rejects malformed or inverted block/pagination inputs %#", async range => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(getSwaps.execute(client, {poolId: "1", ...range})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps validated empty holder coverage but rejects an absent swaps array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({data: []}))));
    await expect(getHolders.execute(client, {coinId: "0"})).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({data: {swaps: {}}}))));
    await expect(getSwaps.execute(client, {poolId: "0"})).rejects.toThrow(/coverage/);
  });

  it("redacts GraphQL diagnostics and malformed numeric provider fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({errors: [{message: "https://private.example/key"}]}))));
    await expect(zammGraphql("query Test { pool(id: 1) { id } }", {})).rejects.toThrow(/^Unreadable or unsuccessful ZAMM GraphQL response$/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({data: {pool: {...pool, reserve0: "private-provider-key"}}}))));
    await expect(getPool.execute(client, {poolId: "42"})).rejects.toThrow(/^Unreadable ZAMM numeric response$/);
  });
});
