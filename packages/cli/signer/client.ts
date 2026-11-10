import { connect, type Socket } from "node:net";
import { toAccount } from "viem/accounts";
import { isHex, toHex, type Account, type Hex, type SignableMessage, type TransactionSerializable } from "viem";
import {
  getSocketPath,
  RPC_METHODS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js";

let rpcIdCounter = 0;

function rpcReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function normalizeSignableMessage(message: SignableMessage): SignableMessage {
  if (typeof message === "string") return message;

  const raw = message.raw;
  if (typeof raw === "string") {
    if (!isHex(raw)) {
      throw new Error("Invalid raw message: expected hex string");
    }
    return { raw };
  }

  return { raw: toHex(raw) };
}

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
      socket.write(JSON.stringify(request, rpcReplacer) + "\n");
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

    socket.on("end", () => { clearTimeout(timeout); reject(new Error("Signer connection closed before a response")); });
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

export async function shutdownDaemon(): Promise<void> {
  const res = await sendRpcRequest(RPC_METHODS.SHUTDOWN);
  if (res.error) throw new Error(res.error.message);
}

export function createDaemonAccount(address: Hex): Account {
  return toAccount({
    address,

    async signMessage({ message }): Promise<Hex> {
      const res = await sendRpcRequest(RPC_METHODS.SIGN_MESSAGE, {
        message: normalizeSignableMessage(message),
      });
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },

    async signTransaction(tx: TransactionSerializable): Promise<Hex> {
      const res = await sendRpcRequest(RPC_METHODS.SIGN_TRANSACTION, tx);
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },

    async signTypedData(typedData): Promise<Hex> {
      const res = await sendRpcRequest(RPC_METHODS.SIGN_TYPED_DATA, typedData);
      if (res.error) throw new Error(res.error.message);
      return res.result as Hex;
    },
  }) as Account;
}
