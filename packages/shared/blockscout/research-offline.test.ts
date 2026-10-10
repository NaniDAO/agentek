import { test, expect } from "bun:test";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import * as tools from "./tools.js";
import { resolveENSTool } from "../ens/tools.js";
import { verifyResearch } from "./research-fixtures.mjs";
test("synthetic named-collection recipient research against actual shared tools, offline", async () => {
  const original = globalThis.fetch;
  const client = { getPublicClient: () => createPublicClient({ chain: mainnet, transport: http("http://offline.invalid", { retryCount: 0 }) }) };
  try {
    const report = await verifyResearch(async (name: string, args: any) => {
      const tool = name === "resolveENS" ? resolveENSTool : (tools as any)[name];
      return tool.execute(client, tool.parameters.parse(args));
    }, (fetch: any) => { globalThis.fetch = fetch; });
    expect(report.syntheticSender).toHaveLength(42);
  } finally { globalThis.fetch = original; }
});
