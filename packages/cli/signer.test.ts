import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { encrypt, decrypt } from "./signer/crypto.js";
import { defaultPolicy, evaluatePolicy } from "./signer/policy.js";
import { createDaemonAccount } from "./signer/client.js";
import { startDaemon, stopDaemon } from "./signer/daemon.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { DecryptedPayload, JsonRpcRequest, JsonRpcResponse } from "./signer/protocol.js";
import { RPC_METHODS, RPC_ERRORS, getSocketPath } from "./signer/protocol.js";

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
  it("should allow a preapproved recipient transaction within limits", () => {
    const policy = defaultPolicy();
    policy.contracts = { "0x1234567890abcdef1234567890abcdef12345678": ["*"] };
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

  it("should reject transactions when chainId is missing", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 0n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("chainId is required");
  });

  it("should reject contract creation when allowContractCreation is false", () => {
    const policy = defaultPolicy();
    const result = evaluatePolicy(policy, {
      chainId: 1,
      data: "0x6000",
      value: 0n,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Contract creation is disabled");
  });

  it("should allow contract creation when allowContractCreation is true", () => {
    const policy = defaultPolicy();
    policy.allowContractCreation = true;
    const result = evaluatePolicy(policy, {
      chainId: 1,
      data: "0x6000",
      value: 0n,
    });
    expect(result.allowed).toBe(true);
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
    policy.contracts = { "0x1234567890abcdef1234567890abcdef12345678": ["*"] };
    const result = evaluatePolicy(policy, {
      chainId: 1,
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: 60000000000000000n, // 0.06 ETH > 50% of 0.1 ETH
    });
    expect(result.allowed).toBe(true);
    expect(result.needsApproval).toBe(true);
  });

  it("should not require approval below threshold for an explicitly preapproved recipient", () => {
    const policy = defaultPolicy();
    policy.contracts = { "0x1234567890abcdef1234567890abcdef12345678": ["*"] };
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
  let prevConfigDir: string | undefined;

  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
  const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  function sendRpc(socketPath: string, method: string, params?: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 10000);
      if (method === RPC_METHODS.SIGN_TRANSACTION && params && typeof params === "object") {
        const tx = params as Record<string, unknown>;
        params = { nonce: 0, gas: "21000", ...(tx.maxFeePerGas === undefined ? { gasPrice: "1" } : {}), ...tx };
      }
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
    prevConfigDir = process.env.AGENTEK_CONFIG_DIR;
    process.env.AGENTEK_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    stopDaemon();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (prevConfigDir === undefined) delete process.env.AGENTEK_CONFIG_DIR;
    else process.env.AGENTEK_CONFIG_DIR = prevConfigDir;
  });

  /** Exercise the production server and handler, with an explicit approving operator. */
  async function startTestDaemon(
    policyMutator?: (policy: ReturnType<typeof defaultPolicy>) => void,
  ): Promise<string> {
    const policy = defaultPolicy();
    policy.requireApproval = "never";
    policyMutator?.(policy);
    await startDaemon({ privateKey: TEST_KEY, policy }, { approve: async () => true });
    return getSocketPath();
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

  it("should reject transaction when chainId is missing", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "0",
      gas: "21000",
      gasPrice: "1",
      type: "legacy",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(RPC_ERRORS.INVALID_PARAMS);
    expect(res.error!.message).toContain("chainId is required");
  }, 10_000);

  it("should reject contract creation when allowContractCreation is false", async () => {
    const socketPath = await startTestDaemon();
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      chainId: 1,
      data: "0x6000",
      value: "0",
      gas: "100000",
      gasPrice: "1",
      type: "legacy",
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(RPC_ERRORS.POLICY_DENIED);
    expect(res.error!.message).toContain("Contract creation is disabled");
  }, 10_000);

  it("should allow contract creation when allowContractCreation is true", async () => {
    const socketPath = await startTestDaemon((policy) => {
      policy.allowContractCreation = true;
    });
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_TRANSACTION, {
      chainId: 1,
      data: "0x6000",
      value: "0",
      gas: "100000",
      gasPrice: "1",
      type: "legacy",
    });
    expect(res.error).toBeUndefined();
    expect(typeof res.result).toBe("string");
    expect((res.result as string).startsWith("0x")).toBe(true);
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

  it("should preserve raw message semantics when signing", async () => {
    const socketPath = await startTestDaemon();
    const raw = "0x010203";
    const res = await sendRpc(socketPath, RPC_METHODS.SIGN_MESSAGE, { message: { raw } });
    expect(res.error).toBeUndefined();
    const expected = await privateKeyToAccount(TEST_KEY).signMessage({ message: { raw } });
    expect(res.result).toBe(expected);
  }, 10_000);

  it("daemon account should sign typed data with bigint fields", async () => {
    await startTestDaemon();
    const daemonAccount = createDaemonAccount(TEST_ADDRESS as Hex);
    const typedData = {
      domain: {
        name: "Agentek",
        version: "1",
        chainId: 1,
        verifyingContract: "0x0000000000000000000000000000000000000001",
      },
      types: {
        Transfer: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
      },
      primaryType: "Transfer",
      message: {
        to: "0x1234567890abcdef1234567890abcdef12345678",
        amount: 1234567890123456789n,
      },
    } as const;

    const expected = await privateKeyToAccount(TEST_KEY).signTypedData(typedData);
    const actual = await daemonAccount.signTypedData(typedData);
    expect(actual).toBe(expected);
  }, 10_000);

  it("rejects invalid policy before opening the signer socket", async () => {
    await expect(startTestDaemon(policy => { policy.maxValuePerTx = "not-an-eth-amount"; })).rejects.toThrow();
    expect(existsSync(getSocketPath())).toBe(false);
  }, 10_000);
});

describe("Signer — daemon hardening", () => {
  let tmpDir: string;
  let prevConfigDir: string | undefined;

  const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentek-signer-hardening-"));
    prevConfigDir = process.env.AGENTEK_CONFIG_DIR;
    process.env.AGENTEK_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    try { stopDaemon(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (prevConfigDir === undefined) delete process.env.AGENTEK_CONFIG_DIR;
    else process.env.AGENTEK_CONFIG_DIR = prevConfigDir;
  });

  function pingDaemon(): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const socket = connect(getSocketPath(), () => {
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: RPC_METHODS.PING }) + "\n");
      });

      let buffer = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("ping timeout"));
      }, 5_000);

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const idx = buffer.indexOf("\n");
        if (idx !== -1) {
          clearTimeout(timeout);
          socket.destroy();
          try {
            resolve(JSON.parse(buffer.slice(0, idx)));
          } catch {
            reject(new Error("invalid ping response"));
          }
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  it("should close oversized RPC frames without crashing the daemon", async () => {
    const policy = defaultPolicy();
    policy.requireApproval = "never";

    await startDaemon({
      privateKey: TEST_KEY,
      policy,
    });

    await new Promise<void>((resolve, reject) => {
      const socket = connect(getSocketPath(), () => {
        socket.write("x".repeat(300 * 1024));
      });
      // Drain the error response so EOF/close can be observed on the client.
      socket.resume();

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timeout = setTimeout(() => {
        socket.destroy();
        settle(() => reject(new Error("oversized frame was not closed in time")));
      }, 5_000);

      socket.on("close", () => {
        clearTimeout(timeout);
        settle(resolve);
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EPIPE" || code === "ECONNRESET") {
          settle(resolve);
          return;
        }
        settle(() => reject(err));
      });
    });

    const ping = await pingDaemon();
    expect(ping.error).toBeUndefined();
    expect(ping.result).toBe("pong");
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

  it("signer stop should not kill unrelated PID when daemon is unreachable", async () => {
    const sleeper = spawn("node", ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    expect(sleeper.pid).toBeDefined();

    try {
      writeFileSync(join(tmpDir, "signer.pid"), String(sleeper.pid), { mode: 0o600 });
      writeFileSync(join(tmpDir, "signer.sock"), "stale-socket", { mode: 0o600 });

      const { stdout, exitCode } = await run(["signer", "stop"], { AGENTEK_CONFIG_DIR: tmpDir });
      expect(exitCode).toBe(0);

      const result = parseJson(stdout);
      expect(result.ok).toBe(true);
      expect(result.wasRunning).toBe(false);
      expect(result.staleStateCleaned).toBe(true);
      expect(() => process.kill(sleeper.pid!, 0)).not.toThrow();
    } finally {
      sleeper.kill("SIGTERM");
    }
  });
});

describe("Signer — exact policy inputs", () => {
  it("rejects fractional approval thresholds and rounded value limits", () => {
    const policy = defaultPolicy();
    expect(() => evaluatePolicy({...policy, approvalThresholdPct: 50.5}, {chainId: 1, to: `0x${"1".repeat(40)}`, value: 0n})).toThrow();
    expect(() => evaluatePolicy({...policy, maxValuePerTx: "0.0000000000000000001"}, {chainId: 1, to: `0x${"1".repeat(40)}`, value: 0n})).toThrow();
  });
});
