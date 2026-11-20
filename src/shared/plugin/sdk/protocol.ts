export interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcSuccess {
  jsonrpc: "2.0";
  id: number | string | null;
  result: unknown;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string };
}

export type RpcResponse = RpcSuccess | RpcFailure;

export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unauthorized: -32001,
  denied: -32002,
  timeout: -32003,
} as const;

export const PLUGIN_RPC_ENV = {
  endpoint: "QNOTE_PLUGIN_RPC",
  token: "QNOTE_PLUGIN_TOKEN",
  id: "QNOTE_PLUGIN_ID",
  version: "QNOTE_PLUGIN_VERSION",
} as const;

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.method === "string" && source.method.length > 0;
}
