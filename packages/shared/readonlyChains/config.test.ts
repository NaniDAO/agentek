import { afterEach, expect, it, vi } from "vitest";
import { readOnlyChainTools } from "./index.js";
afterEach(() => vi.unstubAllGlobals());
it("uses the configured Solana endpoint when the caller omits a cluster", async () => {
  const fetch = vi.fn(async () => Response.json({jsonrpc: "2.0", id: 1, result: {value: 123, context: {slot: 2}}}));
  vi.stubGlobal("fetch", fetch);
  const tool = readOnlyChainTools().find(tool => tool.name === "getSolBalance")!;
  const result = await tool.execute({getSolanaRpcUrl: () => "https://configured-devnet.example"} as any, {address: "11111111111111111111111111111111"});
  expect(String(fetch.mock.calls[0][0])).toBe("https://configured-devnet.example");
  expect(result.cluster).toBe("configured"); expect(result.result.lamports).toBe("123");
});
