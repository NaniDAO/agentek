import { afterEach, describe, expect, it, vi } from "vitest";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { z } from "zod";
import { createAgentekClient, createTool, OperationExecutionError, TransactionExecutionError, SolanaExecutionError } from "../client.js";
import { safeErrorMessage, sanitizeToolError, sanitizeToolOutput } from "./safe-errors.js";
import { getNameTool } from "../erc20/tools.js";
import { getNFTMetadataTool } from "../erc721/tools.js";
import { researchCA } from "../researchCA/tools.js";

const hash = `0x${"a".repeat(64)}`;
const owner = `0x${"1".repeat(40)}` as const;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("credential-safe output boundaries", () => {
  it("redacts numeric and hash-shaped URL credentials, including isolated diagnostics", () => {
    const numeric = "12345678901234567890", tokenHash = `0x${"e".repeat(64)}`;
    vi.stubEnv("RPC_URLS", `1=https://user:${numeric}@rpc.example/?api_key=${tokenHash}`);
    const output = sanitizeToolOutput({ nested: [{reason: `authentication failed for ${numeric}`}, {reason: tokenHash}], hash, quantity: "100" });
    expect(output.nested).toEqual([{reason: "authentication failed for [REDACTED]"}, {reason: "[REDACTED]"}]);
    expect(output.hash).toBe(hash); expect(output.quantity).toBe("100");
  });

  it("redacts numeric path diagnostics while retaining separate public execution fields", () => {
    const client = {getSolanaRpcUrl: () => `https://rpc.example/100/${hash}`};
    expect(sanitizeToolOutput({ quantity: "100", hash, error: `failed token 100 ${hash}` }, client)).toEqual({ quantity: "100", hash, error: "failed token [REDACTED] [REDACTED]" });
  });

  it("scrubs each RPC_URLS endpoint and decoded, encoded and mixed-encoded URL components", () => {
    vi.stubEnv("RPC_URLS", "1=https://rpc-user:p%40ss@rpc.example/tenant%2Fprivate?api_key=query%2Fcredential,8453=https://second.example/other-secret");
    const output = sanitizeToolOutput({
      ok: true,
      endpoint: "https://rpc-user:p%40ss@rpc.example/tenant%2Fprivate?api_key=query%2Fcredential",
      partial: [{ reason: "provider returned tenant/private and query%2Fcredential" }, { nested: "%74enant%2fprivate other-secret p@ss" }],
      quantity: "8453", transactionHash: hash,
    });
    expect(output.endpoint).toBe("https://rpc.example");
    expect(output.quantity).toBe("8453");
    expect(output.transactionHash).toBe(hash);
    const serialized = JSON.stringify(output);
    for (const secret of ["rpc-user", "p@ss", "p%40ss", "tenant", "private", "query", "credential", "other-secret"]) expect(serialized).not.toContain(secret);
  });

  it("discovers direct custom http transports and protects nested direct tool.execute results", async () => {
    const token = "direct-custom-token";
    const endpoint = `https://direct.example/v2/${token}?access_key=direct-query-token`;
    const tool = createTool({ name: "nestedFixture", description: "fixture", parameters: z.object({}),
      execute: async () => ({ partial: [{ error: `RPC ${endpoint}` }, { reason: token }, { detail: "direct-query-token" }], amountRaw: "2", hash }),
    });
    const client = createAgentekClient({ chains: [mainnet], transports: [http(endpoint)], accountOrAddress: owner, tools: [tool], executionMode: "prepare" });
    const result = await tool.execute(client, {});
    expect(result.amountRaw).toBe("2"); expect(result.hash).toBe(hash);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token); expect(serialized).not.toContain("direct-query-token");
  });

  it("does not disclose raw error text, provider bodies, causes or unknown thrown values", () => {
    const error = new Error("sensitive provider body", { cause: new Error("private URL") });
    expect(safeErrorMessage(error)).toBe("Tool execution failed");
    expect(sanitizeToolError(error).message).toBe("Tool execution failed");
    expect(sanitizeToolError("sensitive primitive").message).toBe("Tool execution failed");
    expect(JSON.stringify(sanitizeToolOutput({ partial: [error] }))).toBe('{"partial":[{"message":"Tool execution failed","name":"Error"}]}');
    const timeout = new Error("private timeout details"); timeout.name = "TimeoutError";
    expect(safeErrorMessage(timeout)).toBe("Request timed out");
  });

  it("preserves execution classes and reconciliation records when tool execution fails", async () => {
    const execution = { id: "fixture", chainId: 1, operations: [{ index: 0, op: { chainId: 1, target: owner, value: "0", data: "0x" }, hash, status: "unknown" }], status: "unknown" } as const;
    for (const original of [new TransactionExecutionError("provider private-token", execution as any), new OperationExecutionError("provider private-token", 1, [{ index: 0, hash }], execution as any)]) {
      const tool = createTool({ name: "failedFixture", description: "fixture", parameters: z.object({}), execute: async () => { throw original; } });
      const client = createAgentekClient({ chains: [mainnet], transports: [http("https://rpc.example/private-token")], accountOrAddress: owner, tools: [tool], executionMode: "prepare" });
      try { await client.execute(tool.name, {}); throw new Error("Expected failure"); }
      catch (error) {
        expect(error).toBeInstanceOf(original.constructor);
        expect((error as any).retryable).toBe(false);
        expect(JSON.stringify(error)).toContain(hash);
        expect((error as Error).message).not.toContain("private-token");
      }
    }
  });

  it("discovers nested fallback transports and configured Solana endpoints without redacting public quantities or hashes", () => {
    const client = {
      getPublicClients: () => new Map([
        [1, { transport: { transports: [{ value: { url: `https://fallback.example/100/${hash}/fallback-token` } }] } }],
      ]),
      getSolanaRpcUrl: () => "https://solana.example/?api_key=solana-secret",
    };
    expect(sanitizeToolOutput({ hash, quantity: "100", error: "fallback-token solana-secret" }, client)).toEqual({ hash, quantity: "100", error: "[REDACTED] [REDACTED]" });
  });

  it("retains Solana signature and unknown-outcome reconciliation metadata", () => {
    const execution = { id: "solana-fixture", signature: "synthetic-public-signature", transaction: "unsigned-fixture-bytes", status: "unknown" as const };
    const result = sanitizeToolOutput(new SolanaExecutionError("private provider body", execution));
    expect(result).toMatchObject({ name: "SolanaExecutionError", message: "Tool execution failed", retryable: false, execution });
    expect(JSON.stringify(result)).not.toContain("private provider body");
  });

  it("returns fixed categories for provider bodies in token and research partial results", async () => {
    const raw = "private-provider-body-that-is-not-a-configured-secret";
    const rpc = { readContract: vi.fn(async () => { throw new Error(raw); }), getCode: vi.fn(async () => { throw new Error(raw); }) };
    const client = { getPublicClient: () => rpc, filterSupportedChains: () => [mainnet] } as any;
    expect(await getNameTool.execute(client, { token: owner, chainId: 1 })).toEqual([{ chain: 1, error: "Failed to fetch name: Tool execution failed" }]);
    expect(await getNFTMetadataTool.execute(client, { contractAddress: owner, tokenId: "1", chainId: 1 })).toMatchObject({ error: "Failed to fetch NFT metadata: Tool execution failed" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(raw); }));
    const research = await researchCA.execute(client, { address: owner, chainId: 1 });
    expect(research.contract.codeCheckError).toBe("Tool execution failed");
    expect(JSON.stringify(research)).not.toContain(raw);
    expect(research.sources.every(source => source.error === "Tool execution failed")).toBe(true);
  });
});
