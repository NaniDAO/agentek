import { afterEach, expect, it, vi } from "vitest";
import { getAddressLogs } from "./tools.js";
const address = `0x${"1".repeat(40)}`;
afterEach(() => vi.unstubAllGlobals());
it("continues within a provider page before advancing the upstream cursor", async () => {
  const fetch = vi.fn(async input => Response.json(String(input).includes("page=2") ? {items: [{id: 4}], next_page_params: null} : {items: [{id: 1}, {id: 2}, {id: 3}], next_page_params: {page: 2}}));
  vi.stubGlobal("fetch", fetch);
  const a = await getAddressLogs.execute(null, {chain: 1, address, limit: 2});
  expect(a.items).toEqual([{id: 1}, {id: 2}]); expect(a.complete).toBe(false);
  const b = await getAddressLogs.execute(null, {chain: 1, address, limit: 2, continuation: a.continuation});
  expect(b.items).toEqual([{id: 3}]);
  const c = await getAddressLogs.execute(null, {chain: 1, address, limit: 2, continuation: b.continuation});
  expect(c.items).toEqual([{id: 4}]); expect(c.complete).toBe(true);
  await expect(getAddressLogs.execute(null, {chain: 8453, address, continuation: a.continuation})).rejects.toThrow(/Invalid continuation/);
});
