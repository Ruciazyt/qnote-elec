export type McpTransport = "stdio" | "http" | "sse";

export type McpServerSource = "user" | "project";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  source?: McpServerSource;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export type McpServerStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disabled"
  | "error";

export interface McpServerState {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  source: McpServerSource;
  readOnly?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content?: Array<{ type: string; text?: string; resource?: unknown }>;
  isError?: boolean;
}

export interface McpClientLike {
  connect(transport: unknown, options?: unknown): Promise<void>;
  listTools(params?: unknown, options?: unknown): Promise<{ tools?: McpToolDescriptor[] }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: unknown
  ): Promise<McpCallResult>;
  close(): Promise<void>;
}

export function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function parseArgsLines(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface McpServerInput {
  id?: string;
  name: string;
  transport: McpTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface McpProjectState {
  dir: string | null;
  filePath: string | null;
  error?: string;
}
