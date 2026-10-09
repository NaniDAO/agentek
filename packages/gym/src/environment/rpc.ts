interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
  ) {
    super(`RPC ${method} failed (${code}): ${message}`);
    this.name = "RpcRequestError";
  }
}

let requestId = 0;

export async function rpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) {
    throw new RpcRequestError(method, body.error.code, body.error.message);
  }
  if (!("result" in body)) {
    throw new Error(`RPC ${method} returned no result`);
  }
  return body.result as T;
}
