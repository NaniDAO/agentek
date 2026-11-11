import { createServer, type Server, type Socket } from "node:net";
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline";
import { privateKeyToAccount } from "viem/accounts";
import { hashMessage, hashTypedData, keccak256, serializeTransaction, type Hex, type SignableMessage, type TransactionSerializable, type TypedDataDefinition } from "viem";
import { normalizeTypedData, parseExactUnits } from "@agentek/tools/client";
import { getSocketPath, getPidfilePath, RPC_METHODS, RPC_ERRORS, type JsonRpcRequest, type JsonRpcResponse, type DecryptedPayload } from "./protocol.js";
import { evaluatePolicy, nativeLiability, validatePolicy } from "./policy.js";

let server: Server | null = null;
const connections = new Set<Socket>();
let removeSignalHandlers: (() => void) | undefined;
const MAX_RPC_MESSAGE_BYTES = 256 * 1024;
const MAX_PENDING_REQUESTS = 32;
const UINT256_MAX = 2n ** 256n - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVEN_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

function makeResponse(id: number, result: unknown): JsonRpcResponse { return { jsonrpc: "2.0", id, result }; }
function makeError(id: number, code: number, message: string): JsonRpcResponse { return { jsonrpc: "2.0", id, error: { code, message } }; }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} contains unsupported fields`);
}
function quantity(value: unknown, label: string, max = UINT256_MAX): bigint {
  if (typeof value !== "bigint" && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) && !(typeof value === "number" && Number.isSafeInteger(value))) throw new Error(`${label} must be an exact nonnegative integer`);
  const amount = BigInt(value as bigint | string | number);
  if (amount < 0n || amount > max) throw new Error(`${label} is out of range`);
  return amount;
}
function safeInteger(value: unknown, label: string, positive = false): number {
  const result = Number(quantity(value, label, BigInt(Number.MAX_SAFE_INTEGER)));
  if (positive && result === 0) throw new Error(`${label} is required and must be a positive safe integer`);
  return result;
}
function hex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !EVEN_HEX.test(value)) throw new Error(`${label} must be even-length 0x hexadecimal bytes`);
  return value.toLowerCase() as Hex;
}
function address(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${label} must be an exact 20-byte address`);
  return value.toLowerCase() as Hex;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value) throw new Error(`${label} must be valid Unicode text`);
  return value;
}

/** The only supported signing wire format; no viem inference happens before validation. */
export function normalizeTransaction(value: unknown): TransactionSerializable {
  const p = record(value, "Transaction");
  exactKeys(p, ["chainId", "nonce", "to", "value", "data", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "type", "accessList"], "Transaction");
  if (p.chainId === undefined) throw new Error("chainId is required and must be a positive safe integer");
  const chainId = safeInteger(p.chainId, "chainId", true);
  const nonce = safeInteger(p.nonce, "nonce");
  const gas = quantity(p.gas, "gas");
  if (gas === 0n) throw new Error("gas must be positive");
  const to = p.to === undefined || p.to === null ? undefined : address(p.to, "to");
  const data = p.data === undefined ? "0x" : hex(p.data, "data");
  const txValue = p.value === undefined ? 0n : quantity(p.value, "value");
  const type = p.type ?? (p.maxFeePerGas !== undefined || p.maxPriorityFeePerGas !== undefined ? "eip1559" : p.accessList !== undefined ? "eip2930" : "legacy");
  if (!["legacy", "eip2930", "eip1559"].includes(type as string)) throw new Error("Unsupported transaction type; blob and authorization transactions are disabled");
  const accessList = p.accessList === undefined ? undefined : (() => {
    if (!Array.isArray(p.accessList) || p.accessList.length > 1024) throw new Error("Invalid accessList");
    return p.accessList.map(entry => {
      const item = record(entry, "Access list entry");
      exactKeys(item, ["address", "storageKeys"], "Access list entry");
      if (!Array.isArray(item.storageKeys) || item.storageKeys.length > 1024) throw new Error("Invalid access list storageKeys");
      return { address: address(item.address, "accessList address"), storageKeys: item.storageKeys.map(key => {
        const normalized = hex(key, "storage key");
        if (normalized.length !== 66) throw new Error("Storage keys must contain 32 bytes");
        return normalized;
      }) };
    });
  })();
  const base = { chainId, nonce, gas, to, value: txValue, data };
  if (type === "eip1559") {
    if (p.gasPrice !== undefined) throw new Error("gasPrice conflicts with EIP-1559 fees");
    const maxFeePerGas = quantity(p.maxFeePerGas, "maxFeePerGas");
    const maxPriorityFeePerGas = quantity(p.maxPriorityFeePerGas, "maxPriorityFeePerGas");
    if (maxPriorityFeePerGas > maxFeePerGas) throw new Error("maxPriorityFeePerGas exceeds maxFeePerGas");
    return { ...base, type, maxFeePerGas, maxPriorityFeePerGas, ...(accessList === undefined ? {} : { accessList }) } as TransactionSerializable;
  }
  if (p.maxFeePerGas !== undefined || p.maxPriorityFeePerGas !== undefined) throw new Error("EIP-1559 fields conflict with transaction type");
  if (type === "legacy" && accessList !== undefined) throw new Error("Legacy transactions cannot include an accessList");
  return { ...base, type, gasPrice: quantity(p.gasPrice, "gasPrice"), ...(type === "eip2930" ? { accessList: accessList ?? [] } : {}) } as TransactionSerializable;
}

export { normalizeTypedData } from "@agentek/tools/client";

/** Escape terminal controls and directional formatting; never truncate approvals. */
export function approvalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)
    .replace(/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function tokenEffects(tx: TransactionSerializable): string {
  const data = tx.data ?? "0x";
  const selector = data.slice(0, 10);
  const word = (n: number) => data.slice(10 + n * 64, 10 + (n + 1) * 64);
  const addr = (n: number) => `0x${word(n).slice(24)}`;
  const n = (i: number) => BigInt(`0x${word(i)}`).toString();
  if (data.length === 138 && ["0x095ea7b3", "0xa9059cbb", "0xa22cb465"].includes(selector)) {
    if (!/^0{24}/.test(word(0))) return "Unrecognized calldata effects";
    if (selector === "0x095ea7b3") return `Possible ERC-20 allowance / ERC-721 approval: spender ${addr(0)}, amount/tokenId ${n(1)} (raw units)`;
    if (selector === "0xa9059cbb") return `Possible ERC-20 transfer: recipient ${addr(0)}, amount ${n(1)} (raw units)`;
    if (word(1) === "0".repeat(63) + "1" || word(1) === "0".repeat(64)) return `Possible NFT operator approval: operator ${addr(0)}, approved ${n(1) === "1"}`;
  }
  if (data.length === 202 && ["0x23b872dd", "0x42842e0e"].includes(selector) && /^0{24}/.test(word(0)) && /^0{24}/.test(word(1))) return `Possible token transferFrom: owner ${addr(0)}, recipient ${addr(1)}, amount/tokenId ${n(2)} (raw units)`;
  return data === "0x" ? "No calldata" : "Unrecognized calldata effects; inspect the complete bytes below";
}

type Approval = (message: string, timeoutMs: number, signal?: AbortSignal) => Promise<boolean>;
function promptApproval(message: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      rl.close();
      resolve(approved);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => { process.stderr.write("\nApproval timed out. Denying request.\n"); finish(false); }, timeoutMs);
    signal?.addEventListener("abort", aborted, { once: true });
    rl.on("close", () => finish(false));
    rl.question(`\n${message}\nApprove? [y/N] `, answer => finish(answer.trim().toLowerCase() === "y"));
  });
}

/** Shared production handler for the socket server and direct security regression tests. */
export function createSignerHandler(payload: DecryptedPayload, options: { approve?: Approval } = {}) {
  const account = privateKeyToAccount(payload.privateKey as Hex);
  const policy = validatePolicy(payload.policy);
  const approve = options.approve ?? promptApproval;
  const sessionCap = parseExactUnits(policy.maxValuePerSession ?? policy.maxValuePerTx, 18);
  let sessionLiability = 0n;
  return async (line: string, signal?: AbortSignal): Promise<JsonRpcResponse> => {
    if (Buffer.byteLength(line, "utf8") > MAX_RPC_MESSAGE_BYTES) return makeError(0, RPC_ERRORS.INVALID_REQUEST, "RPC message exceeds size limit");
    let request: JsonRpcRequest;
    try { request = JSON.parse(line); } catch { return makeError(0, RPC_ERRORS.PARSE_ERROR, "Invalid JSON"); }
    if (!request || Array.isArray(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string" || !Number.isSafeInteger(request.id)) return makeError(0, RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC request");
    const { id, method, params } = request;
    const cancelled = () => signal?.aborted === true;
    if (cancelled()) return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "Request disconnected");
    try {
      switch (method) {
        case RPC_METHODS.PING: return makeResponse(id, "pong");
        case RPC_METHODS.GET_ADDRESS: return makeResponse(id, account.address);
        case RPC_METHODS.SIGN_TRANSACTION: {
          let tx: TransactionSerializable;
          try { tx = normalizeTransaction(params); } catch (err) { return makeError(id, RPC_ERRORS.INVALID_PARAMS, err.message); }
          const result = evaluatePolicy(policy, tx);
          if (!result.allowed) return makeError(id, RPC_ERRORS.POLICY_DENIED, result.reason || "Policy denied");
          const liability = nativeLiability(tx);
          if (sessionLiability + liability > sessionCap) return makeError(id, RPC_ERRORS.POLICY_DENIED, "Cumulative native liability exceeds the daemon session cap; restart deliberately to reset the lifetime budget");
          const digest = keccak256(serializeTransaction(tx));
          if (result.needsApproval && !await approve(`Sign transaction${tx.to === undefined ? " (contract creation)" : ""}\n${result.reason ?? ""}\n${tokenEffects(tx)}\nNative liability (value + maximum execution fee): ${liability} wei; additional chain fees may apply.\nSession liability after signing: ${sessionLiability + liability} / ${sessionCap} wei (resets on daemon restart).\nUnsigned transaction digest: ${digest}\n${approvalJson(tx)}`, 60_000, signal)) return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval");
          if (cancelled()) return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "Request disconnected");
          if (sessionLiability + liability > sessionCap) return makeError(id, RPC_ERRORS.POLICY_DENIED, "Cumulative native liability exceeds the daemon session cap");
          sessionLiability += liability;
          try { return makeResponse(id, await account.signTransaction(tx)); }
          catch (err) { sessionLiability -= liability; throw err; }
        }
        case RPC_METHODS.SIGN_MESSAGE: {
          const p = record(params, "Message params");
          exactKeys(p, ["message"], "Message params");
          let message: SignableMessage;
          if (typeof p.message === "string") message = text(p.message, "Personal message");
          else { const raw = record(p.message, "Raw message"); exactKeys(raw, ["raw"], "Raw message"); message = { raw: hex(raw.raw, "Raw message") }; }
          if (!await approve(`Sign personal message (unknown authority/economic effects)\nDigest: ${hashMessage(message)}\n${approvalJson({ message })}`, 60_000, signal) || cancelled()) return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval or request disconnected");
          return makeResponse(id, await account.signMessage({ message }));
        }
        case RPC_METHODS.SIGN_TYPED_DATA: {
          let typed: TypedDataDefinition;
          try { typed = normalizeTypedData(params); } catch (err) { return makeError(id, RPC_ERRORS.INVALID_PARAMS, err.message); }
          const domain = typed.domain!;
          if (policy.allowedChains.length && !policy.allowedChains.includes(Number(domain.chainId))) return makeError(id, RPC_ERRORS.POLICY_DENIED, "Typed data chain is not allowed");
          const verifier = domain.verifyingContract!.toLowerCase();
          if (policy.blockedContracts.includes(verifier) || (policy.allowedContracts.length && !policy.allowedContracts.includes(verifier))) return makeError(id, RPC_ERRORS.POLICY_DENIED, "Typed data verifying contract is not allowed");
          if (!await approve(`Sign typed data (unknown authority/economic effects; inspect all fields)\nDigest: ${hashTypedData(typed)}\n${approvalJson(typed)}`, 60_000, signal) || cancelled()) return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval or request disconnected");
          return makeResponse(id, await account.signTypedData(typed));
        }
        case RPC_METHODS.SHUTDOWN:
          setTimeout(() => { stopDaemon(); process.exit(0); }, 20);
          return makeResponse(id, { ok: true });
        default: return makeError(id, RPC_ERRORS.METHOD_NOT_FOUND, "Unknown RPC method");
      }
    } catch (err) { return makeError(id, RPC_ERRORS.INVALID_PARAMS, err?.message || "Signing failed"); }
  };
}

export function startDaemon(payload: DecryptedPayload, options: { approve?: Approval } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const pidfilePath = getPidfilePath();
    const handleMessage = createSignerHandler(payload, options);
    let requests: Promise<unknown> = Promise.resolve();
    let pending = 0;
    let ready = false;
    if (server) throw new Error("Signer daemon already started in this process");
    if (existsSync(socketPath)) unlinkSync(socketPath);
    server = createServer(conn => {
      if (!ready || connections.size >= 32) { conn.destroy(); return; }
      connections.add(conn);
      const controller = new AbortController();
      let buffer = "";
      let connectionPending = 0;
      conn.setEncoding("utf8");
      conn.on("error", () => conn.destroy());
      conn.on("close", () => { controller.abort(); connections.delete(conn); });
      conn.on("data", chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > MAX_RPC_MESSAGE_BYTES) { conn.destroy(); buffer = ""; return; }
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (!line.trim()) continue;
          if (pending >= MAX_PENDING_REQUESTS || connectionPending >= 8) { conn.destroy(); buffer = ""; return; }
          let immediate = false;
          try { immediate = [RPC_METHODS.PING, RPC_METHODS.GET_ADDRESS, RPC_METHODS.SHUTDOWN].includes(JSON.parse(line)?.method); } catch {}
          pending++; connectionPending++;
          const work = immediate ? handleMessage(line, controller.signal) : requests.catch(() => undefined).then(() => handleMessage(line, controller.signal));
          if (!immediate) requests = work;
          work.then(response => { if (!conn.destroyed) conn.write(JSON.stringify(response) + "\n"); })
            .catch(() => conn.destroy()).finally(() => { pending--; connectionPending--; });
        }
      });
    });
    server.on("error", err => { stopDaemon(); reject(err); });
    server.listen(socketPath, () => {
      try {
        chmodSync(socketPath, 0o600);
        writeFileSync(pidfilePath, String(process.pid), { mode: 0o600 });
        chmodSync(pidfilePath, 0o600);
      } catch (err) { stopDaemon(); reject(err); return; }
      ready = true;
      process.stderr.write(`Signer daemon started (PID ${process.pid})\nListening on ${socketPath}\nAddress: ${privateKeyToAccount(payload.privateKey as Hex).address}\nNative liability budget resets on daemon restart; rollup/additional chain fees require manual review.\n`);
      resolve();
    });
    const cleanup = () => { stopDaemon(); process.exit(0); };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    removeSignalHandlers = () => { process.off("SIGINT", cleanup); process.off("SIGTERM", cleanup); };
  });
}

export function stopDaemon(): void {
  for (const conn of connections) conn.destroy();
  connections.clear();
  removeSignalHandlers?.();
  removeSignalHandlers = undefined;
  if (server) { server.close(); server = null; }
  for (const path of [getSocketPath(), getPidfilePath()]) {
    if (existsSync(path)) { try { unlinkSync(path); } catch {} }
  }
}

export function getDaemonStatus(): { running: boolean; pid?: number } {
  const pidfilePath = getPidfilePath();
  if (!existsSync(pidfilePath)) return { running: false };
  const text = readFileSync(pidfilePath, "utf-8").trim();
  const pid = Number(text);
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(pid) || !existsSync(getSocketPath())) {
    try { unlinkSync(pidfilePath); } catch {}
    return { running: false };
  }
  try { process.kill(pid, 0); return { running: true, pid }; }
  catch { try { unlinkSync(pidfilePath); } catch {} return { running: false }; }
}
