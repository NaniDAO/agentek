import { afterEach, describe, expect, it, vi } from "vitest";
import { custom, encodeErrorResult, hashTypedData, http, parseAbi, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentekClient, createTool, normalizeTypedData, type AgentekClientConfig, type TypedDataSign } from "./client.js";
import { acknowledgeSolanaExecution, createRequestJournal, createSolanaExecutionJournal } from "./execution/journal.js";
import { readContractTool } from "./contract/tools.js";
import { z } from "zod";

const owner = "0x1111111111111111111111111111111111111111" as const;
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
// These unit fixtures explicitly retain execution evidence only for their lifetime.
const make = (extra: Partial<AgentekClientConfig> = {}) => createAgentekClient({ chains: [mainnet], transports: [http()], accountOrAddress: account, tools: [], onExecutionUpdated: () => undefined, ...extra });
afterEach(() => vi.restoreAllMocks());

describe("network and authorization boundaries", () => {
  it("does not follow direct OffchainLookup URLs from a read-only tool", async () => {
    const gatewayFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not be reached"));
    const revert = encodeErrorResult({
      abi: [{ type: "error", name: "OffchainLookup", inputs: [{ name: "sender", type: "address" }, { name: "urls", type: "string[]" }, { name: "callData", type: "bytes" }, { name: "callbackFunction", type: "bytes4" }, { name: "extraData", type: "bytes" }] }],
      errorName: "OffchainLookup", args: [owner, ["http://127.0.0.1:39393/internal?data={data}"], "0x12", "0x12345678", "0x"],
    });
    const transport = custom({ request: async () => { throw Object.assign(new Error("reverted"), { code: 3, data: revert }); } }, { retryCount: 0 });
    const client = make({ transports: [transport], tools: [readContractTool] });
    await expect(client.execute("readContract", { address: owner, functionName: "probe", abi: parseAbi(["function probe() view returns (bytes)"]), chainId: 1 })).rejects.toThrow();
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(client.getExecutionMode()).toBe("prepare");
    expect(client.getWalletClients().size).toBe(0);
  });

  it("does not sign without an independent host approval", async () => {
    const client = make({ executionMode: "execute" });
    const wallet = client.getWalletClient(1) as any;
    wallet.prepareTransactionRequest = vi.fn(async (tx: any) => tx);
    wallet.signTransaction = vi.fn(async () => "0x01");
    await expect(client.executeOps([{ target: owner, value: "1", data: "0x" }], 1)).rejects.toThrow(/Reconcile/);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    await expect(client.executeSign([{ type: "personal_sign", message: "sign me" }], 1)).rejects.toThrow(/authorizeAction/);
  });

  it("rejects missing EVM persistence before preparation, approval or signing", async () => {
    const approve = vi.fn(() => true);
    const client = make({ executionMode: "execute", authorizeAction: approve, onExecutionUpdated: undefined });
    const wallet = client.getWalletClient(1) as any;
    wallet.prepareTransactionRequest = vi.fn();
    wallet.signTransaction = vi.fn();
    const send = vi.spyOn(client.getPublicClient(1), "sendRawTransaction");
    await expect(client.executeOps([{ target: owner, value: "1", data: "0x" }], 1)).rejects.toThrow(/onExecutionUpdated/);
    expect(wallet.prepareTransactionRequest).not.toHaveBeenCalled();
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("approves immutable snapshots and signs only the captured operation", async () => {
    const observed: any[] = [];
    const client = make({ executionMode: "execute", authorizeAction: action => { observed.push(action); expect(Object.isFrozen(action.payload)).toBe(true); return false; } });
    const wallet = client.getWalletClient(1) as any;
    wallet.prepareTransactionRequest = vi.fn(async (tx: any) => ({ ...tx, chainId: 1, gas: 21000n, gasPrice: 1n }));
    wallet.signTransaction = vi.fn();
    await expect(client.executeOps([{ target: owner, value: "2", data: "0x" }], 1)).rejects.toThrow();
    expect(observed[0]).toMatchObject({ kind: "evm_transaction", chainId: 1, payload: { to: owner, value: "2", gas: "21000" } });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
  it("enforces trusted payment and publication budgets atomically", async () => {
    const approve = vi.fn(async () => true);
    const client = make({ executionMode: "execute", authorizeAction: approve, paymentBudgetUsd: "0.1", publicationBudget: 1 });
    const results = await Promise.allSettled([
      client.authorizeAction("payment", {amountRaw: "100000"}, 1),
      client.authorizeAction("payment", {amountRaw: "100000"}, 1),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    await client.authorizeAction("publish", {prompt: "approved"});
    await expect(client.authorizeAction("publish", {prompt: "again"})).rejects.toThrow(/budget/);
    const withoutBudget = make({executionMode: "execute", authorizeAction: approve});
    await expect(withoutBudget.authorizeAction("payment", {amountRaw: "1"}, 1)).rejects.toThrow(/budget/);
    expect(approve).toHaveBeenCalledTimes(2);
  });
});

describe("SDK canonical signature approval", () => {
  const operation = (): TypedDataSign => ({
    type: "typed_data_sign",
    domain: { name: "Example", version: "1", chainId: "1" as any, verifyingContract: owner },
    types: { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] },
    primaryType: "Permit", message: { spender: owner, value: 1234567890123456789n },
  });

  it("refuses a custom domain schema that removes the approved chain or verifier", async () => {
    const approve = vi.fn(() => true);
    const client = make({ executionMode: "execute", authorizeAction: approve });
    const wallet = client.getWalletClient(1) as any;
    wallet.signTypedData = vi.fn();
    for (const fields of [[], [{ name: "name", type: "string" }]]) {
      const sign = operation();
      sign.types.EIP712Domain = fields;
      await expect(client.executeSign([sign], 1)).rejects.toThrow(/EIP712Domain/);
    }
    expect(approve).not.toHaveBeenCalled();
    expect(wallet.signTypedData).not.toHaveBeenCalled();
  });

  it("signs the canonical approved typed payload despite later caller mutation", async () => {
    const original = operation();
    const canonical = normalizeTypedData({ domain: original.domain, types: original.types, primaryType: original.primaryType, message: original.message });
    const expected = await account.signTypedData(canonical);
    const approvals: any[] = [];
    const request = vi.fn(async () => { throw new Error("RPC signing forbidden"); });
    const client = make({ executionMode: "execute", transports: [custom({ request })], authorizeAction: action => {
      approvals.push(action);
      expect(Object.isFrozen(action.payload)).toBe(true);
      expect(Object.isFrozen((action.payload as any).domain)).toBe(true);
      expect(Object.isFrozen((action.payload as any).types.Permit[0])).toBe(true);
      // Mutate the caller's object after this callback returns its approval,
      // before executeSign resumes from awaiting that approval.
      queueMicrotask(() => {
        original.domain.chainId = 8453;
        original.domain.verifyingContract = `0x${"22".repeat(20)}`;
        original.message.value = 999n;
        original.types.Permit = [{ name: "different", type: "string" }];
      });
      return true;
    } });
    expect(await client.executeSign([original], 1)).toEqual([expected]);
    expect(original.message.value).toBe(999n);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ kind: "signature", chainId: 1, payload: { digest: hashTypedData(canonical), domain: { chainId: 1, verifyingContract: owner }, message: { value: "1234567890123456789" } } });
    expect(approvals[0].payload.types.EIP712Domain).toContainEqual({ name: "chainId", type: "uint256" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a typed domain on another execution chain before approval", async () => {
    const approve = vi.fn(() => true);
    const client = make({ executionMode: "execute", authorizeAction: approve });
    const sign = operation(); sign.domain.chainId = 8453;
    await expect(client.executeSign([sign], 1)).rejects.toThrow(/execution chain/);
    expect(approve).not.toHaveBeenCalled();
  });

  it("captures personal raw bytes before an asynchronous approval can mutate the caller buffer", async () => {
    const raw = new Uint8Array([1, 2, 3]);
    const client = make({ executionMode: "execute", authorizeAction: async () => { await Promise.resolve(); raw.fill(9); return true; } });
    const expected = await account.signMessage({ message: { raw: "0x010203" } });
    expect(await client.executeSign([{ type: "personal_sign", message: { raw } }], 1)).toEqual([expected]);
    expect([...raw]).toEqual([9, 9, 9]);
  });
});

describe("durable side-effect request reservations", () => {
  it("returns a completed result after restart and rejects request identity reuse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-requests-"));
    let effects = 0;
    const tool = createTool({ name: "intentTestEffect", description: "Synthetic effect", parameters: z.object({ amount: z.string() }), execute: async () => ({ effect: ++effects }) });
    const config = () => ({ executionMode: "execute" as const, requestStore: createRequestJournal(directory), tools: [tool] });
    try {
      expect(await make(config()).execute(tool.name, { amount: "1" }, { requestId: "payment-1" })).toEqual({ effect: 1 });
      expect(await make(config()).execute(tool.name, { amount: "1" }, { requestId: "payment-1" })).toEqual({ effect: 1 });
      await expect(make(config()).execute(tool.name, { amount: "2" }, { requestId: "payment-1" })).rejects.toThrow(/different action/);
      await expect(make(config()).execute(tool.name, { amount: "1" })).rejects.toThrow(/requestId/);
      expect(effects).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("never reruns an unresolved or interrupted request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-pending-"));
    let effects = 0;
    const tool = createTool({ name: "intentTestAmbiguous", description: "Synthetic ambiguity", parameters: z.object({}), execute: async () => { effects++; throw new Error("ambiguous"); } });
    try {
      const config = { executionMode: "execute" as const, requestStore: createRequestJournal(directory), tools: [tool] };
      await expect(make(config).execute(tool.name, {}, { requestId: "interrupted" })).rejects.toThrow();
      await expect(make(config).execute(tool.name, {}, { requestId: "interrupted" })).rejects.toThrow(/unresolved/);
      expect(effects).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("keeps Solana unknown signatures locked across processes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-solana-journal-"));
    const record = { id: "signature1", signature: "signature1", transaction: "fixture", status: "signed" as const };
    try {
      const first = createSolanaExecutionJournal(directory);
      await first(record);
      await first({ ...record, status: "unknown" });
      await expect(createSolanaExecutionJournal(directory)({ ...record, id: "signature2" })).rejects.toThrow(/locked/);
      await first({ ...record, status: "confirmed" });
      await expect(createSolanaExecutionJournal(directory)({ ...record, id: "signature2" })).resolves.toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each(["signed", "unknown", "submitted"] as const)("requires the live Solana owner to stop before acknowledging %s", async status => {
    const directory = await mkdtemp(join(tmpdir(), "agentek-solana-active-"));
    const record = { id: "liveSignature", signature: "liveSignature", transaction: "fixture", status };
    try {
      await createSolanaExecutionJournal(directory)(record);
      await expect(acknowledgeSolanaExecution(directory, record.id)).rejects.toThrow(/Stop the active signer/);
      const stoppedOwner = vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("No such process"), { code: "ESRCH" }); });
      try { await expect(acknowledgeSolanaExecution(directory, record.id)).resolves.toBeUndefined(); }
      finally { stoppedOwner.mockRestore(); }
      await expect(createSolanaExecutionJournal(directory)({ ...record, id: "laterSignature", signature: "laterSignature", status: "signed" })).resolves.toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
