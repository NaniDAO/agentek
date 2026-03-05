import { describe, it, expect } from "vitest";
import { encodeFunctionData, erc20Abi, maxUint256, parseUnits } from "viem";
import { base } from "viem/chains";
import { intentApproveTool } from "./intents.js";
import { erc20Tools } from "./index.js";
import {
  createReadOnlyTestClient,
  TEST_ADDRESSES,
  validateIntent,
  validateOp,
  validateToolStructure,
} from "../test-helpers.js";

const tools = erc20Tools();
const testClient = createReadOnlyTestClient(tools, [base]);

const TOKEN = TEST_ADDRESSES.usdc.base;
const SPENDER = TEST_ADDRESSES.uniswapRouter;

describe("intentApproveTool", () => {
  describe("tool structure", () => {
    it("should have valid tool structure", () => {
      const result = validateToolStructure(intentApproveTool);
      expect(result.valid).toBe(true);
    });

    it("should be included in erc20Tools collection", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("intentApprove");
    });
  });

  describe("parameter validation", () => {
    it("should accept a numeric amount", () => {
      const parsed = intentApproveTool.parameters.safeParse({
        token: TOKEN,
        amount: "100",
        spender: SPENDER,
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });

    it('should accept "max" as amount', () => {
      const parsed = intentApproveTool.parameters.safeParse({
        token: TOKEN,
        amount: "max",
        spender: SPENDER,
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });

    it('should accept "Max" as amount (case insensitive)', () => {
      const parsed = intentApproveTool.parameters.safeParse({
        token: TOKEN,
        amount: "Max",
        spender: SPENDER,
        chainId: 8453,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("max approval", () => {
    it("should encode max approval with maxUint256", async () => {
      const result = await intentApproveTool.execute(testClient, {
        token: TOKEN,
        amount: "max",
        spender: SPENDER,
        chainId: 8453,
      });

      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      const expectedData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SPENDER, maxUint256],
      });

      expect(result.ops.length).toBe(1);
      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(expectedData);
      expect(op.target).toBe(TOKEN);
      expect(op.value).toBe("0");

      const opValidation = validateOp(result.ops[0] as any);
      expect(opValidation.valid).toBe(true);
    });

    it('should be case insensitive for "MAX"', async () => {
      const result = await intentApproveTool.execute(testClient, {
        token: TOKEN,
        amount: "MAX",
        spender: SPENDER,
        chainId: 8453,
      });

      const expectedData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SPENDER, maxUint256],
      });

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(expectedData);
    });

    it('should include "max (unlimited)" in intent description', async () => {
      const result = await intentApproveTool.execute(testClient, {
        token: TOKEN,
        amount: "max",
        spender: SPENDER,
        chainId: 8453,
      });

      expect(result.intent).toContain("max (unlimited)");
    });
  });

  describe("normal approval", () => {
    it("should encode a specific amount correctly", async () => {
      const result = await intentApproveTool.execute(testClient, {
        token: TOKEN,
        amount: "100",
        spender: SPENDER,
        chainId: 8453,
      });

      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      // USDC has 6 decimals
      const expectedData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SPENDER, parseUnits("100", 6)],
      });

      const op = result.ops[0] as { target: string; value: string; data: string };
      expect(op.data).toBe(expectedData);
    });
  });

  describe("error handling", () => {
    it("should reject ETH address", async () => {
      await expect(
        intentApproveTool.execute(testClient, {
          token: "0x0000000000000000000000000000000000000000",
          amount: "max",
          spender: SPENDER,
          chainId: 8453,
        }),
      ).rejects.toThrow("Cannot approve ETH, only ERC20 tokens");
    });
  });
});
