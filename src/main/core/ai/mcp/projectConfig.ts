import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServerConfig, McpTransport } from "../../../../shared/ai/mcp";
import { expandArgs, expandRecord, expandTemplate, type EnvLookup } from "./env";

export const PROJECT_FILE_NAME = ".mcp.json";
const MAX_FILE_SIZE = 1024 * 1024;

export interface ProjectMcpEntry {
  name: string;
  config: McpServerConfig;
  error?: string;
}

export interface ProjectMcpLoadResult {
  dir: string | null;
  filePath: string | null;
  entries: ProjectMcpEntry[];
  fingerprint: string | null;
  errors: string[];
}

export function projectServerId(name: string): string {
  return `project:${name}`;
}

export function loadProjectMcpConfig(
  dir: string | null,
  lookup: EnvLookup
): ProjectMcpLoadResult {
  const empty: ProjectMcpLoadResult = {
    dir: dir ?? null,
    filePath: null,
    entries: [],
    fingerprint: null,
    errors: [],
  };
  if (!dir) return empty;

  const filePath = path.join(dir, PROJECT_FILE_NAME);
  let raw: string;
  let mtimeMs = 0;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { ...empty, filePath, errors: ["项目配置不是普通文件"] };
    }
    if (stat.size > MAX_FILE_SIZE) {
      return { ...empty, filePath, errors: ["项目配置文件超过 1 MB 上限"] };
    }
    raw = fs.readFileSync(filePath, "utf8");
    mtimeMs = stat.mtimeMs;
  } catch {
    return empty;
  }

  const fingerprint = `${createHash("sha1").update(raw).digest("hex")}:${mtimeMs}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...empty,
      filePath,
      fingerprint,
      errors: [`项目配置解析失败：${message}`],
    };
  }

  const container = parsed as Record<string, unknown>;
  const servers = container?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {
      ...empty,
      filePath,
      fingerprint,
      errors: ["项目配置缺少 mcpServers 字段"],
    };
  }

  const entries: ProjectMcpEntry[] = [];
  for (const [name, value] of Object.entries(
    servers as Record<string, unknown>
  )) {
    entries.push(parseEntry(name, value, lookup));
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return { dir, filePath, entries, fingerprint, errors: [] };
}

function parseEntry(
  name: string,
  raw: unknown,
  lookup: EnvLookup
): ProjectMcpEntry {
  const id = projectServerId(name);
  const base: McpServerConfig = {
    id,
    name,
    transport: "stdio",
    enabled: true,
    source: "project",
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      name,
      config: { ...base, enabled: false },
      error: "项目服务器配置格式无效",
    };
  }

  const node = raw as Record<string, unknown>;
  const transport = detectTransport(node);
  if (!transport) {
    return {
      name,
      config: { ...base, enabled: false },
      error: "不支持的连接方式",
    };
  }

  const enabled = node.enabled !== false;
  const timeout = readTimeout(node.timeout);

  const command = readString(node.command);
  const args = readStringArray(node.args);
  const cwd = readString(node.cwd);
  const url = readString(node.url);
  const env = readRecord(node.env);
  const headers = readRecord(node.headers);

  if (transport === "stdio" && !command) {
    return {
      name,
      config: { ...base, transport, enabled: false },
      error: "stdio 方式必须填写启动命令",
    };
  }
  if (transport !== "stdio" && !url) {
    return {
      name,
      config: { ...base, transport, enabled: false },
      error: "必须填写服务器地址",
    };
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return {
      name,
      config: { ...base, transport, enabled: false },
      error: "地址必须以 http:// 或 https:// 开头",
    };
  }

  const expandedEnv = expandRecord(env, lookup);
  if (!expandedEnv.ok) {
    return {
      name,
      config: { ...base, transport, enabled: false, timeout },
      error: `缺少环境变量 ${expandedEnv.missing}`,
    };
  }
  const expandedHeaders = expandRecord(headers, lookup);
  if (!expandedHeaders.ok) {
    return {
      name,
      config: { ...base, transport, enabled: false, timeout },
      error: `缺少环境变量 ${expandedHeaders.missing}`,
    };
  }
  const expandedArgs = expandArgs(args, lookup);
  if (!expandedArgs.ok) {
    return {
      name,
      config: { ...base, transport, enabled: false, timeout },
      error: `缺少环境变量 ${expandedArgs.missing}`,
    };
  }
  const expandedCommand = command ? expandTemplate(command, lookup) : null;
  if (expandedCommand && !expandedCommand.ok) {
    return {
      name,
      config: { ...base, transport, enabled: false, timeout },
      error: `缺少环境变量 ${expandedCommand.missing}`,
    };
  }
  const expandedUrl = url ? expandTemplate(url, lookup) : null;
  if (expandedUrl && !expandedUrl.ok) {
    return {
      name,
      config: { ...base, transport, enabled: false, timeout },
      error: `缺少环境变量 ${expandedUrl.missing}`,
    };
  }

  const config: McpServerConfig = {
    ...base,
    transport,
    enabled,
    timeout,
    command: expandedCommand ? expandedCommand.value : undefined,
    args: expandedArgs.value.length ? expandedArgs.value : undefined,
    cwd: cwd ?? undefined,
    url: expandedUrl ? expandedUrl.value : undefined,
    env: Object.keys(expandedEnv.value).length ? expandedEnv.value : undefined,
    headers: Object.keys(expandedHeaders.value).length
      ? expandedHeaders.value
      : undefined,
  };

  return { name, config };
}

function detectTransport(node: Record<string, unknown>): McpTransport | null {
  const raw = node.type ?? node.transport;
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (value === "stdio") return "stdio";
    if (value === "http" || value === "streamable-http") return "http";
    if (value === "sse") return "sse";
    return null;
  }
  if (typeof node.command === "string" && node.command.trim()) return "stdio";
  if (typeof node.url === "string" && node.url.trim()) return "http";
  return null;
}

function readTimeout(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.floor(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") out[key] = item;
  }
  return Object.keys(out).length ? out : undefined;
}
