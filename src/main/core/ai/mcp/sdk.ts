
import { createRequire } from "node:module";
import type { McpClientLike } from "./types";

interface McpSdk {
  client: {
    Client: new (
      info: { name: string; version: string },
      options?: unknown
    ) => McpClientLike;
  };
  stdio: {
    StdioClientTransport: new (params: Record<string, unknown>) => unknown;
    getDefaultEnvironment: () => Record<string, string>;
  };
  http: {
    StreamableHTTPClientTransport: new (
      url: URL,
      opts?: Record<string, unknown>
    ) => unknown;
  };
  sse: {
    SSEClientTransport: new (
      url: URL,
      opts?: Record<string, unknown>
    ) => unknown;
  };
}

let cached: McpSdk | null = null;

export function loadMcpSdk(): McpSdk {
  if (cached) return cached;
  const nodeRequire = createRequire(__filename);
  cached = {
    client: nodeRequire("@modelcontextprotocol/sdk/client/index.js"),
    stdio: nodeRequire("@modelcontextprotocol/sdk/client/stdio.js"),
    http: nodeRequire("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    sse: nodeRequire("@modelcontextprotocol/sdk/client/sse.js"),
  };
  return cached;
}
