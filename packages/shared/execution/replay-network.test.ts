import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { http } from "viem";
import { base, mainnet } from "viem/chains";
import { z } from "zod";
import { createAgentekClient, createTool, type AgentekClientConfig } from "../client.js";
import { createRequestJournal } from "./journal.js";

describe("durable request network identity", () => {
  it.each(["chain", "default chain order", "Solana endpoint"])("rejects replay after changing %s", async variant => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-network-replay-"));
    const effect = vi.fn(async client => ({chain: client.getChains()[0].id}));
    const tool = createTool({name: "intentNetworkFixture", description: "Synthetic effect", parameters: z.object({}), execute: effect});
    const config: AgentekClientConfig = {
      chains: variant === "default chain order" ? [mainnet, base] : [mainnet], transports: [http()],
      accountOrAddress: `0x${"1".repeat(40)}`, tools: [tool], executionMode: "execute",
      requestStore: createRequestJournal(directory),
      ...(variant === "Solana endpoint" ? {solana: {address: "11111111111111111111111111111111", rpcUrl: "https://api.mainnet-beta.solana.com"}} : {}),
    };
    try {
      expect(await createAgentekClient(config).execute(tool.name, {}, {requestId: "one-intent"})).toEqual({chain: 1});
      const changed = createAgentekClient({...config,
        ...(variant === "chain" ? {chains: [base]} : variant === "default chain order" ? {chains: [base, mainnet]} : {solana: {...config.solana, rpcUrl: "https://api.devnet.solana.com"}}),
        requestStore: createRequestJournal(directory),
      });
      await expect(changed.execute(tool.name, {}, {requestId: "one-intent"})).rejects.toThrow(/different action/);
      expect(effect).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, {recursive: true, force: true}); }
  });
});
