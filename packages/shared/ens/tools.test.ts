import { describe, it, expect } from "vitest";
import { resolveENSTool, lookupENSTool } from "./tools.js";
import { ensTools } from "./index.js";
import {
  createTestClient,
  TEST_ADDRESSES,
  TEST_ENS,
  validateToolStructure,
  withRetry,
} from "../test-helpers.js";

// Create a test client with real ENS tools (uses mainnet for ENS resolution)
const client = createTestClient(ensTools());

// Notice: viem uses ENS Universal Resolver to resolve ENS names
// CCIP and DNSSEC+ENS names use official ENS Universal/CCIP gateways
describe("ENS Tools", () => {
  describe("Tool Structure", () => {
    it("resolveENSTool should have valid tool structure", () => {
      const result = validateToolStructure(resolveENSTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("lookupENSTool should have valid tool structure", () => {
      const result = validateToolStructure(lookupENSTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("ensTools() should return both tools", () => {
      const tools = ensTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("resolveENS");
      expect(tools.map((t) => t.name)).toContain("lookupENS");
    });
  });

  describe("resolveENSTool", () => {
    it("should resolve vitalik.eth to correct address", async () => {
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "vitalik.eth" })
      );
      expect(address).toEqual(TEST_ADDRESSES.vitalik);
    });

    it("should resolve ENS name without .eth suffix", async () => {
      // Tool should auto-append .eth if no TLD provided
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "vitalik" })
      );
      expect(address).toEqual(TEST_ADDRESSES.vitalik);
    });

    it("should resolve nick.eth to an address", async () => {
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: TEST_ENS.nick })
      );
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should resolve DNSSEC+ENS name to address", async () => {
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "namesys.xyz" })
      );
      expect(address).toEqual("0x59AD62Fe873409969AC636Ec38eDD000411b0847");
    }, 15000);

    it("should resolve emoji ENS name to address", async () => {
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "\u{1F468}\u200D\u{1F373}.eth" })
      );
      expect(address).toEqual("0x087d16Aa5F00F39b87BBeaEFB4124006D2371eAb");
    });

    it("should resolve subdomain ENS names", async () => {
      // Subdomains should also work
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "resolver.eth" })
      );
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should throw error for non-existent ENS name", async () => {
      await expect(
        resolveENSTool.execute(client, {
          name: "thisdoesnotexist12345678901234567890.eth",
        })
      ).rejects.toThrow();
    });
  });

  describe("lookupENSTool", () => {
    it("should lookup vitalik's address to vitalik.eth", async () => {
      const name = await withRetry(() =>
        lookupENSTool.execute(client, { address: TEST_ADDRESSES.vitalik })
      );
      expect(name).toEqual("vitalik.eth");
    });

    it("should lookup emoji ENS name holder address", async () => {
      const name = await withRetry(() =>
        lookupENSTool.execute(client, {
          address: "0x087d16Aa5F00F39b87BBeaEFB4124006D2371eAb",
        })
      );
      expect(name).toEqual("\u{1F468}\u200D\u{1F373}.eth");
    });

    it("should throw error for address without ENS name", async () => {
      // Zero address definitely doesn't have an ENS name set
      await expect(
        lookupENSTool.execute(client, { address: TEST_ADDRESSES.zero })
      ).rejects.toThrow();
    });

    it("should throw error for contract address without reverse record", async () => {
      // Uniswap router contract doesn't have a reverse ENS record
      await expect(
        lookupENSTool.execute(client, { address: TEST_ADDRESSES.uniswapRouter })
      ).rejects.toThrow();
    });
  });

  describe("Round-trip Resolution", () => {
    it("should resolve and lookup back to same name for vitalik.eth", async () => {
      // First resolve the name to address
      const address = await withRetry(() =>
        resolveENSTool.execute(client, { name: "vitalik.eth" })
      );
      expect(address).toEqual(TEST_ADDRESSES.vitalik);

      // Then lookup the address back to name
      const name = await withRetry(() =>
        lookupENSTool.execute(client, { address })
      );
      expect(name).toEqual("vitalik.eth");
    });
  });
});
