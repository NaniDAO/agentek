import { afterEach, expect, it, vi } from "vitest";
import { fetchDefiLlamaPools } from "./utils/api.js";
afterEach(() => vi.unstubAllGlobals());
it("deduplicates simultaneous catalogue fetches and reuses its bounded-lifetime snapshot", async () => {
  const fetch = vi.fn(async () => Response.json({status: "success", data: [{pool: "fixture", chain: "Ethereum"}]}));
  vi.stubGlobal("fetch", fetch);
  const first = fetchDefiLlamaPools(), second = fetchDefiLlamaPools();
  const a = await first, b = await second;
  expect(a).toBe(b); expect(Object.isFrozen(a.data)).toBe(true);
  expect(await fetchDefiLlamaPools()).toBe(a); expect(fetch).toHaveBeenCalledOnce();
});
