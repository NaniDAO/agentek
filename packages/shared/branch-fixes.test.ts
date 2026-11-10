import { describe, expect, it, vi } from "vitest";
import { getAddress, http } from "viem";
import { optimism } from "viem/chains";
import { addressSchema } from "./utils.js";
import { createAgentekClient } from "./client.js";
import { getAllowanceTool } from "./erc20/tools.js";
import { ETH_ADDRESS, intentTransferTool, intentTransferFromTool } from "./transfer/intents.js";

describe("retained fixes from PR 64", () => {
  const mixed = "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const normalized = getAddress(mixed.toLowerCase());

  it("normalizes mixed-case addresses while rejecting malformed addresses", () => {
    expect(addressSchema.parse(mixed)).toBe(normalized);
    expect(addressSchema.safeParse("0xnot-an-address").success).toBe(false);
  });

  it("normalizes token, owner and spender before reading ERC20 allowance", async () => {
    const readContract = vi.fn(async ({ functionName }) => functionName === "decimals" ? 6 : 1_000_000n);
    const client = {
      filterSupportedChains: () => [optimism],
      getPublicClient: () => ({ readContract }),
    };
    const result = await getAllowanceTool.execute(client as any, { token: mixed, owner: mixed, spender: mixed, chainId: 10 });
    expect(result).toEqual([{ chain: 10, allowance: "1" }]);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: normalized, functionName: "allowance", args: [normalized, normalized] }));
  });

  it("builds an unsigned native transfer on Optimism without falling back to another chain", async () => {
    const client = createAgentekClient({
      accountOrAddress: normalized, chains: [optimism], transports: [http()],
      tools: [intentTransferTool, intentTransferFromTool],
    });
    vi.spyOn(client, "getPublicClient").mockReturnValue({
      getBalance: async () => 2_000_000_000_000_000_000n,
      getGasPrice: async () => 1n,
      estimateGas: async () => 21000n,
      estimateFeesPerGas: async () => ({gasPrice: 1n}),
      getChainId: async () => 10,
      readContract: async () => 1n,
    } as any);
    const result = await client.execute("intentTransfer", { token: ETH_ADDRESS, to: normalized, amount: "1", chainId: 10 });
    expect(result).toMatchObject({ chain: 10, ops: [{ target: normalized.toLowerCase(), value: "1000000000000000000", data: "0x" }] });
    expect(intentTransferFromTool.supportedChains.some(chain => chain.id === 10)).toBe(true);
  });
});
