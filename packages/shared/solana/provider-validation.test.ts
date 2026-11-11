import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentekClient } from "../client.js";
import { SOLANA_TOKENS, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
import { getSolBalanceTool, getSolanaTokenBalancesTool, getSolanaTokenBalanceTool, getSolanaTokenSupplyTool } from "./tools.js";
import { intentTransferSolTool, intentTransferSplTokenTool } from "./intents.js";
import { solanaRpc } from "./rpc.js";

const owner = SOLANA_TOKENS.WSOL;
const client = {getSolanaRpcUrl: () => "https://rpc.example/private-key"} as AgentekClient;
const response = (request: any, result: unknown) => new Response(JSON.stringify({jsonrpc: "2.0", id: request.id, result}));
const tokenAccount = (program: string, amount = "1500000", decimals = 6) => ({
  pubkey: SOLANA_TOKENS.BONK,
  account: {owner: program, data: {parsed: {info: {mint: SOLANA_TOKENS.USDC, tokenAmount: {amount, decimals, uiAmountString: "999"}}}}},
});
afterEach(() => vi.unstubAllGlobals());

describe("Solana evidence validation", () => {
  it.each([{}, {result: undefined}, {result: null, error: {message: "private-key"}}, {result: [], jsonrpc: "1.0"}])("rejects malformed RPC envelopes %#", async envelope => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({jsonrpc: "2.0", id: request.id, ...envelope}));
    }));
    await expect(solanaRpc(client.getSolanaRpcUrl(), "getTokenAccountsByOwner")).rejects.toThrow(/failed or malformed/);
  });

  it("preserves explicit null results for missing-account semantics", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), null)));
    await expect(solanaRpc(client.getSolanaRpcUrl(), "getAccountInfo")).resolves.toBeNull();
  });

  it.each([null, {}, {value: []}, {context: {slot: 4}, value: null}, {context: {slot: 4}, value: [{}]}])("rejects incomplete Token-2022 coverage %#", async malformed => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      return response(request, request.params[1].programId === TOKEN_PROGRAM_ID ? {context: {slot: 4}, value: []} : malformed);
    }));
    await expect(getSolanaTokenBalancesTool.execute(client, {owner})).rejects.toThrow(/coverage unavailable/);
  });

  it("lists legitimate accounts from both programs and derives display amounts exactly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init.body));
      const program = request.params[1].programId;
      return response(request, {context: {slot: 4}, value: [tokenAccount(program, program === TOKEN_PROGRAM_ID ? "1500000" : "2500000")]});
    }));
    const result = await getSolanaTokenBalancesTool.execute(client, {owner});
    expect(result.count).toBe(2);
    expect(result.balances.map(balance => balance.uiAmount)).toEqual(["2.5", "1.5"]);
    expect(new Set(result.balances.map(balance => balance.program))).toEqual(new Set(["token", "token-2022"]));
  });

  it("preserves a validated empty response as zero holdings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), {context: {slot: 4}, value: []})));
    await expect(getSolanaTokenBalanceTool.execute(client, {owner, token: "USDC"})).resolves.toMatchObject({amount: "0", decimals: null, tokenAccounts: []});
  });

  it("rejects differing decimals before summing accounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), {context: {slot: 4}, value: [tokenAccount(TOKEN_PROGRAM_ID), tokenAccount(TOKEN_2022_PROGRAM_ID, "1000", 9)]})));
    await expect(getSolanaTokenBalanceTool.execute(client, {owner, token: "USDC"})).rejects.toThrow(/precision/);
  });

  it.each([-1, "-1", 1.5, "18446744073709551616", "1e9"])("rejects invalid lamport quantities %s", async value => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), {context: {slot: 4}, value})));
    await expect(getSolBalanceTool.execute(client, {address: owner})).rejects.toThrow(/coverage unavailable/);
  });

  it("keeps exact u64 balances and validates supply decimals", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), {context: {slot: 4}, value: "18446744073709551615"})));
    await expect(getSolBalanceTool.execute(client, {address: owner})).resolves.toMatchObject({lamports: "18446744073709551615", sol: "18446744073.709551615"});
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => response(JSON.parse(String(init.body)), {context: {slot: 4}, value: {amount: "1", decimals: -1, uiAmountString: "1"}})));
    await expect(getSolanaTokenSupplyTool.execute(client, {token: "USDC"})).rejects.toThrow(/coverage unavailable/);
  });
});

describe("Solana priority fee bounds", () => {
  it.each([NaN, Infinity, -1, 1.1, 1_000_001, Number.MAX_SAFE_INTEGER + 1])("rejects unbounded fee %s before any RPC", async fee => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const tool of [intentTransferSolTool, intentTransferSplTokenTool]) {
      await expect(tool.execute(client, {to: owner, amount: "1", token: "USDC", priorityFeeMicroLamports: fee})).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([0, 1, 100_000, 1_000_000])("preserves legitimate fee %s", fee => {
    expect(intentTransferSolTool.parameters.safeParse({to: owner, amount: "1", priorityFeeMicroLamports: fee}).success).toBe(true);
  });
});
