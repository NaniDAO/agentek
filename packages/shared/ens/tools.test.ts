import { describe, it, expect } from "vitest";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { resolveENSTool, lookupENSTool } from "./tools.js";
import { AgentekClient, createAgentekClient } from "../client.js";
import { ensTools } from ".";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const mockClient: AgentekClient = createAgentekClient({
  transports: [http()],
  chains: [mainnet],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: ensTools(),
});

// Notice : viem uses ENS Universal Resolver to resolve ENS names
// CCIP and DNSSEC+ENS name use official ENS Universal/CCIP gateways
describe("ENS Tools", () => {
  describe("resolveENSTool", () => {
    it("should resolve ENS name to address", async () => {
      const address = await resolveENSTool.execute(mockClient, {
        name: "vitalik.eth",
      });
      expect(address).toEqual("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    });
  });

  describe("resolveENSTool", () => {
    it("should resolve DNSSEC+ENS name to address", async () => {
      const address = await resolveENSTool.execute(mockClient, {
        name: "namesys.xyz",
      });
      expect(address).toEqual("0x59AD62Fe873409969AC636Ec38eDD000411b0847");
    });
  }, 10000);

  describe("resolveENSTool", () => {
    it("should resolve Emoji ENS name to address", async () => {
      const address = await resolveENSTool.execute(mockClient, {
        name: "👨‍🍳.eth",
      });
      expect(address).toEqual("0x087d16Aa5F00F39b87BBeaEFB4124006D2371eAb");
    });
  });

  describe("resolveENSTool", () => {
    it("should resolve third-party name service domains", async () => {
      const address = await resolveENSTool.execute(mockClient, {
        name: "hodl.hey.id",
      });
      expect(address).toEqual("0x91769843CEc84Adcf7A48DF9DBd9694A39f44b42");
    });
  });

  describe("lookupENSTool", () => {
    it("should lookup ENS address to name", async () => {
      const name = await lookupENSTool.execute(mockClient, {
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      });
      expect(name).toEqual("vitalik.eth");
    });
  });

  describe("lookupENSTool", () => {
    it("should lookup ENS address to name", async () => {
      const name = await lookupENSTool.execute(mockClient, {
        address: "0x087d16Aa5F00F39b87BBeaEFB4124006D2371eAb",
      });
      expect(name).toEqual("👨‍🍳.eth");
    });
  });
});
