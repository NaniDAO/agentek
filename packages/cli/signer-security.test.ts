import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { hashMessage, hashTypedData, keccak256, parseTransaction, serializeTransaction } from "viem";
import { approvalJson, createSignerHandler, normalizeTransaction, normalizeTypedData, startDaemon, stopDaemon } from "./signer/daemon.js";
import { defaultPolicy, evaluatePolicy } from "./signer/policy.js";
import { getSocketPath, RPC_ERRORS, RPC_METHODS, type JsonRpcResponse } from "./signer/protocol.js";

const KEY = `0x${"11".repeat(32)}` as const;
const TO = `0x${"22".repeat(20)}` as const;
const OTHER = `0x${"33".repeat(20)}` as const;
const tx = (overrides = {}) => ({ chainId: 1, nonce: 0, to: TO, value: "0", gas: "21000", gasPrice: "1", ...overrides });
const typed = (overrides = {}) => ({
  domain: { name: "Example", version: "1", chainId: "1", verifyingContract: TO },
  primaryType: "Permit",
  types: { Permit: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "note", type: "string" }] },
  message: { spender: OTHER, value: "1", note: "complete contents" },
  ...overrides,
});
const line = (method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
function handler(options: { policy?: Partial<ReturnType<typeof defaultPolicy>>; approved?: boolean } = {}) {
  const approve = vi.fn(async () => options.approved ?? true);
  const handle = createSignerHandler({ privateKey: KEY, policy: { ...defaultPolicy(), ...options.policy } }, { approve });
  return { approve, request: (method: string, params: unknown) => handle(line(method, params)) };
}

describe("Signer security: canonical transactions", () => {
  it.each([
    { to: "" }, { to: "0x" }, { to: "0x1234" }, { to: false },
    { data: "0x1" }, { data: "0X1234" }, { data: 1234 },
    { chainId: 1.5 }, { chainId: Number.MAX_SAFE_INTEGER + 1 }, { chainId: "0x1" },
    { nonce: -1 }, { nonce: 1.5 }, { nonce: Number.MAX_SAFE_INTEGER + 1 },
    { value: "-1" }, { value: "1e3" }, { value: "0x10" }, { value: "01" }, { value: Number.MAX_SAFE_INTEGER + 1 },
    { value: (2n ** 256n).toString() }, { gas: "-1" }, { gas: "0" }, { gasPrice: "-1" },
    { type: "eip4844" }, { type: "eip7702" }, { blobs: [] }, { blobVersionedHashes: [] },
    { maxFeePerBlobGas: "1" }, { authorizationList: [] }, { kzg: {} }, { r: `0x${"00".repeat(32)}` },
    { accessList: [], type: "legacy" }, { type: "eip1559", maxFeePerGas: "2", maxPriorityFeePerGas: "1" },
    { unknownField: "ignored by viem" },
  ])("denies malformed or unsupported transaction before approval: %j", async malformed => {
    const h = handler();
    const result = await h.request(RPC_METHODS.SIGN_TRANSACTION, tx(malformed));
    expect(result.error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it("requires nonce, gas and complete fees instead of signing inferred zero fields", async () => {
    const h = handler();
    for (const field of ["nonce", "gas", "gasPrice"]) {
      const input = tx();
      delete input[field];
      expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, input)).error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    }
    const eip1559 = { ...tx(), type: "eip1559", maxFeePerGas: "2" };
    delete eip1559.gasPrice;
    expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, eip1559)).error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it("normalizes exact decimal RPC quantities before policy and signing", async () => {
    const h = handler({ policy: { requireApproval: "always" } });
    const wire = tx({ chainId: "1", nonce: "3", to: TO.toUpperCase().replace("0X", "0x"), data: "0xABCD" });
    const canonical = normalizeTransaction(wire);
    const result = await h.request(RPC_METHODS.SIGN_TRANSACTION, wire);
    expect(result.error).toBeUndefined();
    expect(result.result).toBe(await privateKeyToAccount(KEY).signTransaction(canonical));
    const display = h.approve.mock.calls[0][0];
    expect(display).toContain(keccak256(serializeTransaction(canonical)));
    expect(display).toContain('"data": "0xabcd"');
    expect(parseTransaction(result.result as `0x${string}`).nonce).toBe(3);
  });

  it.each(["eip2930", "eip1559"])("supports complete %s transactions", async type => {
    const input: Record<string, unknown> = tx({ type, accessList: [{ address: TO, storageKeys: [`0x${"00".repeat(32)}`] }] });
    if (type === "eip1559") { delete input.gasPrice; input.maxFeePerGas = "2"; input.maxPriorityFeePerGas = "1"; }
    expect((await handler().request(RPC_METHODS.SIGN_TRANSACTION, input)).error).toBeUndefined();
  });

  it("includes maximum execution fees in the hard cap and approval threshold", async () => {
    const h = handler();
    const denied = await h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ gas: "100000", gasPrice: "1000000000000" }));
    // 0.1 ETH execution fee plus one wei value must exceed the 0.1 cap.
    expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ value: "1", gas: "100000", gasPrice: "1000000000000" }))).error?.code).toBe(RPC_ERRORS.POLICY_DENIED);
    expect(denied.error).toBeUndefined();
    expect(h.approve).toHaveBeenCalledTimes(1);
    const fees = handler();
    const input: Record<string, unknown> = tx({ type: "eip1559", gas: "100000", maxFeePerGas: "600000000000", maxPriorityFeePerGas: "1" });
    delete input.gasPrice;
    expect((await fees.request(RPC_METHODS.SIGN_TRANSACTION, input)).error).toBeUndefined();
    expect(fees.approve).toHaveBeenCalledTimes(1);
  });

  it("requires review for zero-value calldata/deployment unless explicitly preapproved", async () => {
    const h = handler({ policy: { allowContractCreation: true }, approved: false });
    expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ data: "0x095ea7b3" }))).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ to: null, data: "0x6000" }))).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    expect(h.approve).toHaveBeenCalledTimes(2);
    const preapproved = handler({ policy: { contracts: { [TO]: ["0x095ea7b3"] } }, approved: false });
    expect((await preapproved.request(RPC_METHODS.SIGN_TRANSACTION, tx({ data: "0x095ea7b3" }))).error).toBeUndefined();
    expect(preapproved.approve).not.toHaveBeenCalled();
    expect((await preapproved.request(RPC_METHODS.SIGN_TRANSACTION, tx({ data: "0xa9059cbb" }))).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
  });

  it("preserves the published contracts-map approval semantics", () => {
    const policy = { ...defaultPolicy(), contracts: {} };
    expect(evaluatePolicy(policy, tx()).needsApproval).toBe(true);
    expect(evaluatePolicy({ ...policy, contracts: { [TO]: ["*"] } }, tx()).needsApproval).toBe(false);
    expect(evaluatePolicy(defaultPolicy(), tx()).needsApproval).toBe(true);
  });

  it.each([{ value: "0" }, { value: "1" }, { value: "0", data: "0x" }, { value: "1", data: "0x" }])("requires review of unknown recipients with omitted/empty calldata: %j", async fields => {
    const h = handler({ policy: { allowedContracts: [TO] }, approved: false });
    const result = await h.request(RPC_METHODS.SIGN_TRANSACTION, tx(fields));
    expect(result.error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    expect(h.approve).toHaveBeenCalledOnce();
    expect(h.approve.mock.calls[0][0]).toContain("empty calldata can invoke contract fallback code");
  });

  it("permits a native transfer only with explicit wildcard recipient preapproval below threshold", async () => {
    const preapproved = handler({ policy: { contracts: { [TO]: ["*"] } }, approved: false });
    const result = await preapproved.request(RPC_METHODS.SIGN_TRANSACTION, tx({ value: "1", data: "0x" }));
    expect(result.error).toBeUndefined();
    expect(result.result).toBe(await privateKeyToAccount(KEY).signTransaction(normalizeTransaction(tx({ value: "1", data: "0x" }))));
    expect(preapproved.approve).not.toHaveBeenCalled();
    const selectorOnly = handler({ policy: { contracts: { [TO]: ["0x095ea7b3"] } }, approved: false });
    expect((await selectorOnly.request(RPC_METHODS.SIGN_TRANSACTION, tx())).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    const optedOut = handler({ policy: { requireApproval: "never" }, approved: false });
    expect((await optedOut.request(RPC_METHODS.SIGN_TRANSACTION, tx())).error).toBeUndefined();
    expect(optedOut.approve).not.toHaveBeenCalled();
  });

  it("requires manual review for extra/unknown chain fees even under never", async () => {
    const h = handler({ policy: { requireApproval: "never" }, approved: false });
    expect((await h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ chainId: 8453 }))).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    expect(h.approve.mock.calls[0][0]).toContain("Additional chain fees are not bounded");
  });

  it("reserves a finite cumulative liability budget before asynchronous signing", async () => {
    const h = handler({ policy: { requireApproval: "never" } });
    const results = await Promise.all([0, 1, 2].map(nonce => h.request(RPC_METHODS.SIGN_TRANSACTION, tx({ nonce, value: "40000000000000000" }))));
    expect(results.filter(result => !result.error)).toHaveLength(2);
    expect(results[2].error?.code).toBe(RPC_ERRORS.POLICY_DENIED);
    expect(results[2].error?.message).toContain("session cap");
  });
});

describe("Signer security: complete signature authority", () => {
  it("enforces typed-data chain and verifier restrictions even under never", async () => {
    for (const domain of [
      { ...typed().domain, chainId: "999" },
      { ...typed().domain, verifyingContract: OTHER },
    ]) {
      const h = handler({ policy: { requireApproval: "never", allowedContracts: [TO] } });
      expect((await h.request(RPC_METHODS.SIGN_TYPED_DATA, typed({ domain }))).error?.code).toBe(RPC_ERRORS.POLICY_DENIED);
      expect(h.approve).not.toHaveBeenCalled();
    }
    const blocked = handler({ policy: { requireApproval: "never", blockedContracts: [TO] } });
    expect((await blocked.request(RPC_METHODS.SIGN_TYPED_DATA, typed())).error?.code).toBe(RPC_ERRORS.POLICY_DENIED);
  });

  it("hashes, displays and signs identical typed data after bigint-string chain normalization", async () => {
    const h = handler({ policy: { requireApproval: "never" } });
    const input = typed();
    const canonical = normalizeTypedData(input);
    const result = await h.request(RPC_METHODS.SIGN_TYPED_DATA, input);
    expect(result.result).toBe(await privateKeyToAccount(KEY).signTypedData(canonical));
    expect(h.approve).toHaveBeenCalledOnce();
    expect(h.approve.mock.calls[0][0]).toContain(hashTypedData(canonical));
    expect(h.approve.mock.calls[0][0]).toContain('"chainId": 1');
    expect(canonical.types.EIP712Domain).toContainEqual({ name: "chainId", type: "uint256" });
  });

  it.each([
    { types: { ...typed().types, EIP712Domain: [] } },
    { types: { ...typed().types, EIP712Domain: [{ name: "name", type: "string" }] } },
    { domain: { ...typed().domain, chainId: undefined } },
    { domain: { ...typed().domain, verifyingContract: undefined } },
    { domain: { ...typed().domain, hidden: "unsigned" } },
    { message: { ...typed().message, hidden: "unsigned" } },
    { message: { ...typed().message, value: "-1" } },
    { types: { Permit: [{ name: "value", type: "uint256" }, { name: "value", type: "uint256" }] } },
  ])("rejects ambiguous typed authority or unsigned displayed fields: %j", async malformed => {
    const h = handler({ policy: { requireApproval: "never" } });
    expect((await h.request(RPC_METHODS.SIGN_TYPED_DATA, typed(malformed))).error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it("shows full personal/typed contents and escapes terminal/bidi controls", async () => {
    const h = handler({ policy: { requireApproval: "never" }, approved: false });
    const note = "x".repeat(200) + "\u001b[2J\u202eDANGER\u2066";
    expect((await h.request(RPC_METHODS.SIGN_MESSAGE, { message: note })).error?.code).toBe(RPC_ERRORS.APPROVAL_DENIED);
    const shown = h.approve.mock.calls[0][0];
    expect(shown).toContain("x".repeat(200));
    expect(shown).toContain(hashMessage(note));
    expect(shown).toContain("\\u001b[2J\\u202eDANGER\\u2066");
    expect(shown).not.toContain("\u001b");
    expect(shown).not.toContain("\u202e");
    await h.request(RPC_METHODS.SIGN_TYPED_DATA, typed({ message: { ...typed().message, note } }));
    expect(h.approve.mock.calls[1][0]).toContain("x".repeat(200));
    expect(h.approve.mock.calls[1][0]).toContain("\\u202eDANGER");
    expect(approvalJson("\r\n\u009b")).toBe('"\\r\\n\\u009b"');
  });

  it("decodes approval effects alongside complete calldata and fees", async () => {
    const h = handler();
    const data = `0x095ea7b3${OTHER.slice(2).padStart(64, "0")}${"f".repeat(64)}`;
    const input: Record<string, unknown> = tx({ data, type: "eip1559", maxFeePerGas: "2", maxPriorityFeePerGas: "1" });
    delete input.gasPrice;
    await h.request(RPC_METHODS.SIGN_TRANSACTION, input);
    const shown = h.approve.mock.calls[0][0];
    expect(shown).toContain("allowance / ERC-721 approval");
    expect(shown).toContain(OTHER);
    expect(shown).toContain((2n ** 256n - 1n).toString());
    expect(shown).toContain(data);
    expect(shown).toContain('"maxFeePerGas": "2"');
    expect(shown).toContain('"maxPriorityFeePerGas": "1"');
  });

  it("requires approval for empty personal messages and preserves raw bytes", async () => {
    const h = handler({ policy: { requireApproval: "never" } });
    expect((await h.request(RPC_METHODS.SIGN_MESSAGE, { message: "" })).result).toBe(await privateKeyToAccount(KEY).signMessage({ message: "" }));
    const raw = { raw: "0x010203" } as const;
    expect((await h.request(RPC_METHODS.SIGN_MESSAGE, { message: raw })).result).toBe(await privateKeyToAccount(KEY).signMessage({ message: raw }));
    expect(h.approve).toHaveBeenCalledTimes(2);
  });

  it("rejects unpaired surrogate text before displaying or hashing different UTF-8 bytes", async () => {
    const h = handler();
    expect((await h.request(RPC_METHODS.SIGN_MESSAGE, { message: "\ud800" })).error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect((await h.request(RPC_METHODS.SIGN_TYPED_DATA, typed({ message: { ...typed().message, note: "\udfff" } }))).error?.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect(h.approve).not.toHaveBeenCalled();
  });
});

describe("Signer security: production socket lifecycle", () => {
  let temp: string | undefined;
  let previous: string | undefined;
  afterEach(() => {
    stopDaemon();
    if (temp) rmSync(temp, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AGENTEK_CONFIG_DIR;
    else process.env.AGENTEK_CONFIG_DIR = previous;
  });

  it("cancels active and queued requests on disconnect without consuming signing budget", async () => {
    previous = process.env.AGENTEK_CONFIG_DIR;
    temp = mkdtempSync(join(tmpdir(), "agentek-signer-security-"));
    process.env.AGENTEK_CONFIG_DIR = temp;
    let promptStarted!: () => void;
    const prompt = new Promise<void>(resolve => { promptStarted = resolve; });
    const approve = vi.fn((_message: string, _timeout: number, signal?: AbortSignal) => new Promise<boolean>(resolve => {
      promptStarted();
      signal?.addEventListener("abort", () => resolve(false), { once: true });
    }));
    await startDaemon({ privateKey: KEY, policy: { ...defaultPolicy(), requireApproval: "never", maxValuePerSession: "0.00000000000006" } }, { approve });
    expect(statSync(getSocketPath()).mode & 0o777).toBe(0o600);
    const first = connect(getSocketPath(), () => first.write(line(RPC_METHODS.SIGN_MESSAGE, { message: "hold queue" }) + "\n"));
    first.on("error", () => undefined);
    await prompt;
    const abandoned = connect(getSocketPath(), () => {
      abandoned.write(line(RPC_METHODS.SIGN_TRANSACTION, tx({ value: "30000" })) + "\n", () => abandoned.destroy());
    });
    abandoned.on("error", () => undefined);
    await new Promise<void>(resolve => abandoned.once("close", resolve));
    // Let the server observe the abandoned request's close before draining queue.
    await new Promise(resolve => setTimeout(resolve, 20));
    first.destroy();
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      const socket = connect(getSocketPath(), () => socket.write(line(RPC_METHODS.SIGN_TRANSACTION, tx()) + "\n"));
      let buffer = "";
      const timeout = setTimeout(() => { socket.destroy(); reject(new Error("socket request timed out")); }, 2000);
      socket.on("error", reject);
      socket.on("data", chunk => {
        buffer += chunk;
        if (buffer.includes("\n")) { clearTimeout(timeout); socket.destroy(); resolve(JSON.parse(buffer.split("\n")[0])); }
      });
    });
    expect(response.error).toBeUndefined();
    expect(approve).toHaveBeenCalledOnce();
  }, 5000);
});
