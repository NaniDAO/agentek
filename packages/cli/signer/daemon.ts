import { createServer, type Server } from "node:net";
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, TransactionSerializable, TypedDataDefinition } from "viem";
import {
  getSocketPath,
  getPidfilePath,
  RPC_METHODS,
  RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type DecryptedPayload,
} from "./protocol.js";
import { evaluatePolicy, type TxRequest } from "./policy.js";

let server: Server | null = null;

function makeResponse(id: number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id: number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function promptApproval(message: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.stderr.write("\nApproval timed out. Denying request.\n");
      rl.close();
      resolve(false);
    }, timeoutMs);

    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`\n${message}\nApprove? [y/N] `, (answer) => {
      clearTimeout(timer);
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export function startDaemon(payload: DecryptedPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const pidfilePath = getPidfilePath();
    const account = privateKeyToAccount(payload.privateKey as Hex);
    const policy = payload.policy;

    // Clean up stale socket
    if (existsSync(socketPath)) {
      try { unlinkSync(socketPath); } catch {}
    }

    server = createServer((conn) => {
      let buffer = "";

      conn.on("data", (chunk) => {
        buffer += chunk.toString();

        // Process complete JSON-RPC messages (newline-delimited)
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (!line.trim()) continue;

          handleMessage(line, account, policy).then((response) => {
            conn.write(JSON.stringify(response) + "\n");
          });
        }
      });
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(socketPath, () => {
      // Set socket permissions to owner-only
      try { chmodSync(socketPath, 0o600); } catch {}

      // Write PID file
      writeFileSync(pidfilePath, String(process.pid), { mode: 0o600 });

      process.stderr.write(`Signer daemon started (PID ${process.pid})\n`);
      process.stderr.write(`Listening on ${socketPath}\n`);
      process.stderr.write(`Address: ${account.address}\n`);
      resolve();
    });

    // Cleanup on exit
    const cleanup = () => {
      stopDaemon();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}

async function handleMessage(
  line: string,
  account: ReturnType<typeof privateKeyToAccount>,
  policy: DecryptedPayload["policy"],
): Promise<JsonRpcResponse> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line);
  } catch {
    return makeError(0, RPC_ERRORS.PARSE_ERROR, "Invalid JSON");
  }

  if (!request.jsonrpc || !request.method || request.id === undefined) {
    return makeError(request?.id ?? 0, RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  const { id, method, params } = request;

  switch (method) {
    case RPC_METHODS.PING:
      return makeResponse(id, "pong");

    case RPC_METHODS.GET_ADDRESS:
      return makeResponse(id, account.address);

    case RPC_METHODS.SIGN_TRANSACTION: {
      const tx = params as TxRequest & TransactionSerializable;
      if (!tx) return makeError(id, RPC_ERRORS.INVALID_PARAMS, "Missing transaction params");

      const policyResult = evaluatePolicy(policy, tx);
      if (!policyResult.allowed) {
        return makeError(id, RPC_ERRORS.POLICY_DENIED, policyResult.reason || "Policy denied");
      }

      if (policyResult.needsApproval) {
        const valueStr = tx.value ? `${tx.value} wei` : "0";
        const approved = await promptApproval(
          `Sign transaction to ${tx.to || "contract creation"} for ${valueStr} on chain ${tx.chainId || "unknown"}?`,
          60_000,
        );
        if (!approved) {
          return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval");
        }
      }

      try {
        const signed = await account.signTransaction(tx as TransactionSerializable);
        return makeResponse(id, signed);
      } catch (err: any) {
        return makeError(id, RPC_ERRORS.INTERNAL_ERROR, err.message || "Signing failed");
      }
    }

    case RPC_METHODS.SIGN_MESSAGE: {
      const p = params as { message: string } | undefined;
      if (!p?.message) return makeError(id, RPC_ERRORS.INVALID_PARAMS, "Missing message param");

      if (policy.requireApproval !== "never") {
        const preview = p.message.length > 80 ? p.message.slice(0, 80) + "..." : p.message;
        const approved = await promptApproval(
          `Sign message: "${preview}"?`,
          60_000,
        );
        if (!approved) {
          return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval");
        }
      }

      try {
        const sig = await account.signMessage({ message: p.message });
        return makeResponse(id, sig);
      } catch (err: any) {
        return makeError(id, RPC_ERRORS.INTERNAL_ERROR, err.message || "Signing failed");
      }
    }

    case RPC_METHODS.SIGN_TYPED_DATA: {
      const p = params as TypedDataDefinition | undefined;
      if (!p) return makeError(id, RPC_ERRORS.INVALID_PARAMS, "Missing typed data params");

      if (policy.requireApproval !== "never") {
        const approved = await promptApproval(
          `Sign typed data (primaryType: ${(p as any).primaryType || "unknown"})?`,
          60_000,
        );
        if (!approved) {
          return makeError(id, RPC_ERRORS.APPROVAL_DENIED, "User denied approval");
        }
      }

      try {
        const sig = await account.signTypedData(p as TypedDataDefinition);
        return makeResponse(id, sig);
      } catch (err: any) {
        return makeError(id, RPC_ERRORS.INTERNAL_ERROR, err.message || "Signing failed");
      }
    }

    default:
      return makeError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

export function stopDaemon(): void {
  const socketPath = getSocketPath();
  const pidfilePath = getPidfilePath();

  if (server) {
    server.close();
    server = null;
  }

  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch {}
  }

  if (existsSync(pidfilePath)) {
    try { unlinkSync(pidfilePath); } catch {}
  }
}

export function getDaemonStatus(): { running: boolean; pid?: number } {
  const pidfilePath = getPidfilePath();
  if (!existsSync(pidfilePath)) {
    return { running: false };
  }

  const pid = parseInt(readFileSync(pidfilePath, "utf-8").trim(), 10);
  if (isNaN(pid)) {
    return { running: false };
  }

  // Check if process is alive
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return { running: true, pid };
  } catch {
    // PID file is stale
    try { unlinkSync(pidfilePath); } catch {}
    return { running: false };
  }
}
