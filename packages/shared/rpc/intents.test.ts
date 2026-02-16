import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi, parseEther } from "viem";
import { base, mainnet } from "viem/chains";
import { intentSendTransaction } from "./intents.js";
import { rpcTools } from "./index.js";
import {
  createReadOnlyTestClient,
  TEST_ADDRESSES,
  validateIntent,
  validateOp,
  validateToolStructure,
} from "../test-helpers.js";

// Read-only client (no wallet) so intents are returned without execution
const tools = rpcTools();
const testClient = createReadOnlyTestClient(tools, [base, mainnet]);

describe("intentSendTransaction", () => {
  describe("tool structure", () => {
    it("should have valid tool structure", () => {
      const result = validateToolStructure(intentSendTransaction);
      expect(result.valid).toBe(true);
    });

    it("should be included in rpcTools collection", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("intentSendTransaction");
    });
  });

  describe("parameter validation", () => {
    it("should accept valid abi + functionName + args", () => {
      const parsed = intentSendTransaction.parameters.safeParse({
        to: TEST_ADDRESSES.usdc.base,
        abi: ["function transfer(address to, uint256 amount) returns (bool)"],
        functionName: "transfer",
        args: [TEST_ADDRESSES.vitalik, "1000000"],
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });

    it("should accept valid raw data", () => {
      const parsed = intentSendTransaction.parameters.safeParse({
        to: TEST_ADDRESSES.vitalik,
        data: "0x1234abcd",
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });

    it("should accept plain ETH send (no data, no abi)", () => {
      const parsed = intentSendTransaction.parameters.safeParse({
        to: TEST_ADDRESSES.vitalik,
        value: "0.1",
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });

    it("should reject invalid address", () => {
      const parsed = intentSendTransaction.parameters.safeParse({
        to: "not-an-address",
        chainId: 8453,
      });
      expect(parsed.success).toBe(false);
    });

    it("should reject missing chainId", () => {
      const parsed = intentSendTransaction.parameters.safeParse({
        to: TEST_ADDRESSES.vitalik,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("ABI encoding", () => {
    it("should encode ERC20 transfer correctly", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        abi: ["function transfer(address to, uint256 amount) returns (bool)"],
        functionName: "transfer",
        args: [TEST_ADDRESSES.vitalik, "1000000"],
        chainId: 8453,
      });

      // Verify intent structure
      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      // Verify the encoded data matches what viem would produce directly
      const expectedData = encodeFunctionData({
        abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
        functionName: "transfer",
        args: [TEST_ADDRESSES.vitalik, BigInt("1000000")],
      });

      expect(result.ops.length).toBe(1);
      expect(result.ops[0]).toHaveProperty("data");
      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(expectedData);
      expect(op.target).toBe(TEST_ADDRESSES.usdc.base);
      expect(op.value).toBe("0");
    });

    it("should encode ERC20 approve correctly", async () => {
      const spender = TEST_ADDRESSES.uniswapRouter;
      const amount = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // max uint256

      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        abi: ["function approve(address spender, uint256 amount) returns (bool)"],
        functionName: "approve",
        args: [spender, amount],
        chainId: 8453,
      });

      const expectedData = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve",
        args: [spender, BigInt(amount)],
      });

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(expectedData);
    });

    it("should encode function with no args", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.weth.base,
        abi: ["function deposit() payable"],
        functionName: "deposit",
        value: "1.0",
        chainId: 8453,
      });

      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.value).toBe(parseEther("1.0").toString());
      expect(op.target).toBe(TEST_ADDRESSES.weth.base);
    });

    it("should throw on invalid ABI signature", async () => {
      await expect(
        intentSendTransaction.execute(testClient, {
          to: TEST_ADDRESSES.usdc.base,
          abi: ["this is not a valid abi"],
          functionName: "transfer",
          args: [],
          chainId: 8453,
        })
      ).rejects.toThrow();
    });
  });

  describe("raw data", () => {
    it("should pass through raw hex data", async () => {
      const rawData = "0x095ea7b3000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000000001";

      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        data: rawData,
        chainId: 8453,
      });

      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(rawData);
      expect(op.value).toBe("0");
    });

    it("should reject raw data not starting with 0x", async () => {
      await expect(
        intentSendTransaction.execute(testClient, {
          to: TEST_ADDRESSES.usdc.base,
          data: "1234abcd",
          chainId: 8453,
        })
      ).rejects.toThrow("Raw data must be a hex string starting with 0x");
    });
  });

  describe("plain ETH send", () => {
    it("should create intent for plain ETH transfer", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.vitalik,
        value: "0.5",
        chainId: 8453,
      });

      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      expect(result.ops.length).toBe(1);
      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.target).toBe(TEST_ADDRESSES.vitalik);
      expect(op.value).toBe(parseEther("0.5").toString());
      expect(op.data).toBe("0x");
      expect(result.chain).toBe(8453);
    });

    it("should default value to 0", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        abi: ["function totalSupply() view returns (uint256)"],
        functionName: "totalSupply",
        chainId: 8453,
      });

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.value).toBe("0");
    });
  });

  describe("intent metadata", () => {
    it("should include function description in intent string for ABI calls", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        abi: ["function transfer(address to, uint256 amount) returns (bool)"],
        functionName: "transfer",
        args: [TEST_ADDRESSES.vitalik, "1000000"],
        chainId: 8453,
      });

      expect(result.intent).toContain("transfer");
      expect(result.intent).toContain(TEST_ADDRESSES.usdc.base);
    });

    it("should describe plain ETH sends", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.vitalik,
        value: "1.0",
        chainId: 1,
      });

      expect(result.intent).toContain("transfer ETH");
      expect(result.chain).toBe(1);
    });

    it("should describe raw data calls", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.usdc.base,
        data: "0xabcdef",
        chainId: 8453,
      });

      expect(result.intent).toContain("raw call");
    });

    it("should not have a hash when using read-only client", async () => {
      const result = await intentSendTransaction.execute(testClient, {
        to: TEST_ADDRESSES.vitalik,
        value: "0.01",
        chainId: 8453,
      });

      expect(result).not.toHaveProperty("hash");
    });
  });

  describe("op validation", () => {
    it("should produce valid ops for all call types", async () => {
      const results = await Promise.all([
        // ABI call
        intentSendTransaction.execute(testClient, {
          to: TEST_ADDRESSES.usdc.base,
          abi: ["function balanceOf(address) view returns (uint256)"],
          functionName: "balanceOf",
          args: [TEST_ADDRESSES.vitalik],
          chainId: 8453,
        }),
        // Raw data
        intentSendTransaction.execute(testClient, {
          to: TEST_ADDRESSES.usdc.base,
          data: "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
          chainId: 8453,
        }),
        // Plain ETH
        intentSendTransaction.execute(testClient, {
          to: TEST_ADDRESSES.vitalik,
          value: "0.01",
          chainId: 8453,
        }),
      ]);

      for (const result of results) {
        expect(result.ops.length).toBe(1);
        const opValidation = validateOp(result.ops[0] as any);
        expect(opValidation.valid).toBe(true);
      }
    });
  });
});
