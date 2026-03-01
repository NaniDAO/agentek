import { connect, type Socket } from "node:net";
import { toAccount } from "viem/accounts";
import type { Hex, TransactionSerializable, LocalAccount, Account } from "viem";
import {
  getSocketPath,
  RPC_METHODS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

let rpcIdCounter = 0;

function sendRpcRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const id = ++rpcIdCounter;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const socket: Socket = connect(socketPath, () => {
      socket.write(JSON.stringify(request) + "\n");
    });

    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`RPC request timed out after 120s (method: ${method})`));
    }, 120_000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIdx);
        socket.destroy();
        try {
          resolve(JSON.parse(line) as JsonRpcResponse);
        } catch {
          reject(new Error("Invalid JSON response from daemon"));
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function isDaemonReachable(): Promise<boolean> {
  try {
    const res = await sendRpcRequest(RPC_METHODS.PING);
    return res.result === "pong";
  } catch {
    return false;
  }
}

export async function getDaemonAddress(): Promise<Hex> {
  const res = await sendRpcRequest(RPC_METHODS.GET_ADDRESS);
  if (res.error) throw new Error(res.error.message);
  return res.result as Hex;
}

export function createDaemonAccount(address: Hex): Account {
  return toAccount({
    address,

    async signMessage({ message }): Promise<Hex> {
      const msg = typeof message === "string" ? message : (() => {
        if (typeof message === "object" && "raw" in message) {
          const raw = message.raw;
          return typeof raw === "string" ? raw : Buffer.from(raw).toString("hex");
        }
        return String(message);
      })();
      const res = await sendRpcRequest(RPC_METHODS.SIGN_MESSAGE, { message: msg });
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },

    async signTransaction(tx: TransactionSerializable): Promise<Hex> {
      // Convert BigInt values to strings for JSON serialization
      const serializable = JSON.parse(JSON.stringify(tx, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ));
      const res = await sendRpcRequest(RPC_METHODS.SIGN_TRANSACTION, serializable);
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },

    async signTypedData(typedData: any): Promise<Hex> {
      const res = await sendRpcRequest(RPC_METHODS.SIGN_TYPED_DATA, typedData);
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },
  }) as unknown as Account;
}
