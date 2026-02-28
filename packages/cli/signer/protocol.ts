import { join } from "node:path";
import { getConfigDir } from "../config.js";

// ── Path helpers ────────────────────────────────────────────────────────────

export function getSocketPath(): string {
  return join(getConfigDir(), "signer.sock");
}

export function getKeyfilePath(): string {
  return join(getConfigDir(), "keyfile.enc");
}

export function getPidfilePath(): string {
  return join(getConfigDir(), "signer.pid");
}

// ── JSON-RPC ────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── RPC method names ────────────────────────────────────────────────────────

export const RPC_METHODS = {
  GET_ADDRESS: "get_address",
  SIGN_TRANSACTION: "sign_transaction",
  SIGN_MESSAGE: "sign_message",
  SIGN_TYPED_DATA: "sign_typed_data",
  PING: "ping",
} as const;

// ── Error codes ─────────────────────────────────────────────────────────────

export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  POLICY_DENIED: -32000,
  APPROVAL_DENIED: -32001,
} as const;

// ── EIP-2335 V3 keystore ────────────────────────────────────────────────────

export interface V3Keystore {
  version: 3;
  id: string; // uuid-v4
  address: string; // lowercase hex, no 0x prefix
  crypto: {
    cipher: "aes-128-ctr";
    ciphertext: string; // hex
    cipherparams: { iv: string }; // hex (16 bytes)
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
      dklen: number;
      salt: string; // hex (32 bytes)
    };
    mac: string; // hex (keccak256)
  };
}

export interface EncryptedPolicy {
  ciphertext: string; // hex
  iv: string; // hex (12 bytes)
  tag: string; // hex (16 bytes)
}

export interface AgentekKeyfile {
  keystore: V3Keystore;
  encryptedPolicy: EncryptedPolicy;
}

// ── Decrypted payload ───────────────────────────────────────────────────────

export interface DecryptedPayload {
  privateKey: string; // hex with 0x prefix
  policy: PolicyConfig;
}

// ── Policy ──────────────────────────────────────────────────────────────────

export interface PolicyConfig {
  maxValuePerTx: string; // ETH, e.g. "0.1"
  allowedChains: number[];
  blockedContracts: string[]; // lowercase addresses
  allowedContracts: string[]; // lowercase addresses, empty = allow all
  blockedFunctions: string[]; // 4-byte selectors, e.g. "0x095ea7b3"
  requireApproval: "always" | "above_threshold" | "never";
  approvalThresholdPct: number; // 0-100, percentage of maxValuePerTx
}
