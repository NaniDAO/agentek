import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, unlinkSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, connect, type Server } from "node:net";
import { encrypt, decrypt } from "./signer/crypto.js";
import { defaultPolicy, evaluatePolicy } from "./signer/policy.js";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, type Hex, type TransactionSerializable } from "viem";
import type { DecryptedPayload, JsonRpcRequest, JsonRpcResponse, AgentekKeyfile } from "./signer/protocol.js";
import { RPC_METHODS, RPC_ERRORS } from "./signer/protocol.js";

// Use path.resolve to avoid naming collision with Promise resolve
import { resolve as resolvePath } from "node:path";

const CLI = resolvePath(__dirname, "dist/index.mjs");
const SUBPROCESS_TIMEOUT = 30_000;

/** Run the CLI with given args and optional env overrides. */
function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI, ...args],
      { timeout: SUBPROCESS_TIMEOUT, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        const exitCode = err && "code" in err ? (err as any).code as number : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}

function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Expected valid JSON, got:\n${stdout}`);
  }
}

// ── Unit: crypto ────────────────────────────────────────────────────────────

describe("Signer — crypto", () => {
  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const TEST_ADDRESS = "f39fd6e51aad88f6f4ce6ab8827279cfffb92266"; // lowercase, no 0x

  it("should encrypt and decrypt a payload round-trip", () => {
    const payload: DecryptedPayload = {
      privateKey: TEST_KEY,
      policy: defaultPolicy(),
    };

    const keyfile = encrypt(payload, "test-passphrase-123");
    const decrypted = decrypt(keyfile, "test-passphrase-123");

    expect(decrypted.privateKey).toBe(payload.privateKey);
    expect(decrypted.policy.maxValuePerTx).toBe("0.1");
    expect(decrypted.policy.allowedChains).toEqual([1, 8453, 42161, 137, 10]);
  });

  it("should fail with wrong passphrase", () => {
    const payload: DecryptedPayload = {
      privateKey: TEST_KEY,
      policy: defaultPolicy(),
    };

    const keyfile = encrypt(payload, "correct-passphrase");
    expect(() => decrypt(keyfile, "wrong-passphrase")).toThrow("MAC verification failed");
  });

  it("should produce different ciphertexts for same input (random salt/iv)", () => {
    const payload: DecryptedPayload = {
      privateKey: TEST_KEY,
      policy: defaultPolicy(),
    };

    const kf1 = encrypt(payload, "same-passphrase");
    const kf2 = encrypt(payload, "same-passphrase");

    expect(kf1.keystore.crypto.ciphertext).not.toBe(kf2.keystore.crypto.ciphertext);
    expect(kf1.keystore.crypto.kdfparams.salt).not.toBe(kf2.keystore.crypto.kdfparams.salt);
  });

  it("should produce a valid V3 keystore structure", () => {
    const payload: DecryptedPayload = {
      privateKey: TEST_KEY,
      policy: defaultPolicy(),
    };

    const keyfile = encrypt(payload, "test-passphrase");

    // V3 keystore fields
    expect(keyfile.keystore.version).toBe(3);
    expect(keyfile.keystore.address).toBe(TEST_ADDRESS);
    expect(keyfile.keystore.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(keyfile.keystore.crypto.cipher).toBe("aes-128-ctr");
    expect(keyfile.keystore.crypto.kdf).toBe("scrypt");
    expect(keyfile.keystore.crypto.kdfparams.dklen).toBe(32);
    expect(keyfile.keystore.crypto.kdfparams.n).toBe(16384);
    expect(keyfile.keystore.crypto.kdfparams.r).toBe(8);
    expect(keyfile.keystore.crypto.kdfparams.p).toBe(1);

    // Hex field lengths
    expect(keyfile.keystore.crypto.cipherparams.iv).toHaveLength(32); // 16 bytes
    expect(keyfile.keystore.crypto.kdfparams.salt).toHaveLength(64); // 32 bytes
    expect(keyfile.keystore.crypto.mac).toHaveLength(64); // keccak256 = 32 bytes

    // Encrypted policy fields
    expect(keyfile.encryptedPolicy.iv).toHaveLength(24); // 12 bytes
    expect(keyfile.encryptedPolicy.tag).toHaveLength(32); // 16 bytes
    expect(keyfile.encryptedPolicy.ciphertext.length).toBeGreaterThan(0);
  });

  it("extracted keystore should be a standalone valid V3 keystore", () => {
    const payload: DecryptedPayload = {
      privateKey: TEST_KEY,
      policy: defaultPolicy(),
    };

    const keyfile = encrypt(payload, "test-passphrase");

    // Extract just the keystore — this is what you'd import into geth/MetaMask
    const standalone = keyfile.keystore;

    expect(standalone.version).toBe(3);
    expect(standalone.address).toBe(TEST_ADDRESS);
    expect(standalone.crypto).toBeDefined();
    expect(standalone.crypto.cipher).toBe("aes-128-ctr");
    expect(standalone.crypto.kdf).toBe("scrypt");

    // Verify it has all required V3 fields (no extra wrapper fields)
    const keys = Object.keys(standalone).sort();
    expect(keys).toEqual(["address", "crypto", "id", "version"]);

    const cryptoKeys = Object.keys(standalone.crypto).sort();
    expect(cryptoKeys).toEqual(["cipher", "cipherparams", "ciphertext", "kdf", "kdfparams", "mac"]);
  });
});

// ── Unit: policy ────────────────────────────────────────────────────────────

describe("Signer — policy", () => {
  it("should allow a valid transaction within limits", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(false);
  });

  it("should reject transaction on disallowed chain", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 999999,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("999999");
  });

  it("should reject transaction exceeding value cap", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 200000000000000000n, // 0.2 ETH
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds maximum");
  });

  it("should reject blocked contract", () => {
    const policy = defaultPolicy();
    policy.blockedContracts = ["0xdeadbeef00000000000000000000000000000000"];
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0xdeadbeef00000000000000000000000000000000",
      value: 0n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked");
  });

  it("should reject contract not in allowedContracts when list is non-empty", () => {
    const policy = defaultPolicy();
    policy.allowedContracts = ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: 0n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in the allowed list");
  });

  it("should reject blocked function selector", () => {
    const policy = defaultPolicy();
    policy.blockedFunctions = ["0x095ea7b3"]; // approve(address,uint256)
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
      data: "0x095ea7b3000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("selector");
  });

  it("should require approval above threshold (50% of 0.1 ETH = 0.05 ETH)", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 60000000000000000n, // 0.06 ETH > 50% of 0.1 ETH
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(true);
  });

  it("should not require approval below threshold", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 40000000000000000n, // 0.04 ETH < 50% of 0.1 ETH
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(false);
  });

  it("should always require approval when requireApproval is 'always'", () => {
    const policy = defaultPolicy();
    policy.requireApproval = "always";
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(true);
  });

  it("should never require approval when requireApproval is 'never'", () => {
    const policy = defaultPolicy();
    policy.requireApproval = "never";
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 90000000000000000n, // 0.09 ETH, under cap but above threshold
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(false);
  });
});

// ── Integration: in-process daemon over socket ──────────────────────────────

describe("Signer — daemon integration", () => {
  let tmpDir: string;
  let server: Server | null = null;

  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
  const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  function sendRpc(socketPath: string, method: string, params?: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 10000);
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

      const socket = connect(socketPath, () => {
        socket.write(JSON.stringify(request) + "\n");
      });

      let buffer = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("RPC timeout"));
      }, 10_000);

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const idx = buffer.indexOf("\n");
        if (idx !== -1) {
          clearTimeout(timeout);
          socket.destroy();
          try {
            resolve(JSON.parse(buffer.slice(0, idx)));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-signer-test-"));
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  /** Start a minimal in-process daemon on a Unix socket for testing. */
  function startTestDaemon(): Promise<string> {
    const socketPath = join(tmpDir, "signer.sock");
    const account = privateKeyToAccount(TEST_KEY);
    const policy = defaultPolicy();
    policy.requireApproval = "never"; // no interactive prompts in tests

    return new Promise((promiseResolve, promiseReject) => {
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch {}
      }

      server = createServer((conn) => {
        let buf = "";
        conn.on("data", (chunk) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            handleMessage(line, account, policy).then((res) => {
              conn.write(JSON.stringify(res) + "\n");
            });
          }
        });
      });

      server.on("error", promiseReject);

      server.listen(socketPath, () => {
        try { chmodSync(socketPath, 0o600); } catch {}
        promiseResolve(socketPath);
      });
    });
  }

  async function handleMessage(
    line: string,
    account: ReturnType<typeof privateKeyToAccount>,
    policy: ReturnType<typeof defaultPolicy>,
  ): Promise<JsonRpcResponse> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: 0, error: { code: RPC_ERRORS.PARSE_ERROR, message: "Invalid JSON" } };
    }

    const { id, method, params } = request;

    switch (method) {
      case RPC_METHODS.PING:
        return { jsonrpc: "2.0", id, result: "pong" };

      case RPC_METHODS.GET_ADDRESS:
        return { jsonrpc: "2.0", id, result: account.address };

      case RPC_METHODS.SIGN_TRANSACTION: {
        const tx = params as any;
        if (!tx) return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.INVALID_PARAMS, message: "Missing params" } };

        const policyResult = evaluatePolicy(policy, tx);
        if (!policyResult.allowed) {
          return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.POLICY_DENIED, message: policyResult.reason || "Policy denied" } };
        }

        try {
          const signed = await account.signTransaction(tx as TransactionSerializable);
          return { jsonrpc: "2.0", id, result: signed };
        } catch (err: any) {
          return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.INTERNAL_ERROR, message: err.message } };
        }
      }

      case RPC_METHODS.SIGN_MESSAGE: {
        const p = params as { message: string } | undefined;
        if (!p?.message) return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.INVALID_PARAMS, message: "Missing message" } };
        try {
          const sig = await account.signMessage({ message: p.message });
          return { jsonrpc: "2.0", id, result: sig };
        } catch (err: any) {
          return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.INTERNAL_ERROR, message: err.message } };
        }
      }

      default:
        return { jsonrpc: "2.0", id, error: { code: RPC_ERRORS.METHOD_NOT_FOUND, message: `Unknown method: ${method}` } };
    }
  }

  it("should respond to ping", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.PING);
    expect(res.result).toBe("pong");
  }, 10_000);

  it("should return address via get_address", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.GET_ADDRESS);
    expect((res.result as string).toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  }, 10_000);

  it("should sign a transaction", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "0",
      type: "eip1559",
      maxFeePerGas: "1000000000",
      maxPriorityFeePerGas: "100000000",
    });
    expect(res.error).toBeUndefined();
    expect(typeof res.result).toBe("string");
    expect((res.result as string).startsWith("0x")).toBe(true);
  }, 10_000);

  it("should reject transaction on disallowed chain", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      chainId: 999999,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "0",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(RPC_ERRORS.POLICY_DENIED);
    expect(res.error!.message).toContain("999999");
  }, 10_000);

  it("should reject transaction exceeding value cap", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "200000000000000000", // 0.2 ETH
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(RPC_ERRORS.POLICY_DENIED);
    expect(res.error!.message).toContain("exceeds maximum");
  }, 10_000);

  it("should reject unknown RPC method", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, "nonexistent_method");
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(RPC_ERRORS.METHOD_NOT_FOUND);
  }, 10_000);

  it("should sign a message", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_MESSAGE, { message: "hello world" });
    expect(res.error).toBeUndefined();
    expect(typeof res.result).toBe("string");
    expect((res.result as string).startsWith("0x")).toBe(true);
  }, 10_000);
});

// ── CLI: signer command ─────────────────────────────────────────────────────

describe("CLI — signer command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-signer-cli-"));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("signer with no subcommand should error", async () => {
    const { stderr, exitCode } = await run(["signer"], { AGENTEK_CONFIG_DIR: tmpDir });
    expect(exitCode).toBe(1);
    const err = parseJson(stderr);
    expect(err.error).toContain("Usage");
  });

  it("signer status should report not running", async () => {
    const { stdout, exitCode } = await run(["signer", "status"], { AGENTEK_CONFIG_DIR: tmpDir });
    expect(exitCode).toBe(0);
    const result = parseJson(stdout);
    expect(result.running).toBe(false);
  });

  it("signer start without keyfile should error", async () => {
    const { stderr, exitCode } = await run(["signer", "start"], { AGENTEK_CONFIG_DIR: tmpDir });
    expect(exitCode).toBe(1);
    const err = parseJson(stderr);
    expect(err.error).toContain("No keyfile");
  });
});
