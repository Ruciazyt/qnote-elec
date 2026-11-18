export const MCP_TOOL_NAME_MAX_LENGTH = 80;
export const MCP_SERVER_SEGMENT_MAX_LENGTH = 48;

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}]/gu;

export function normalizeMcpNameSegment(
  value: string,
  kind: "server" | "tool"
): string {
  const cleaned = (value ?? "").replace(CONTROL_CHARACTERS, "_");
  const segment = trimUnderscores(
    cleaned.replace(/[^a-zA-Z0-9_-]+/gu, "_").replace(/_+/gu, "_")
  );
  return /[a-zA-Z0-9]/u.test(segment) ? segment : kind;
}

function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "_") start += 1;
  while (end > start && value[end - 1] === "_") end -= 1;
  return value.slice(start, end);
}

function trimTrailingUnderscores(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "_") end -= 1;
  return value.slice(0, end);
}

export function shortenMcpNameSegment(
  segment: string,
  max: number,
  kind: "server" | "tool"
): string {
  if (max < 1) {
    throw new Error(`MCP ${kind} 名称没有可保留的前缀空间`);
  }
  const prefix = trimTrailingUnderscores(segment.slice(0, max));
  return /[a-zA-Z0-9]/u.test(prefix) ? prefix : kind.slice(0, max);
}

export function buildMcpServerRuntimeName(serverName: string): string {
  const segment = shortenMcpNameSegment(
    normalizeMcpNameSegment(serverName, "server"),
    MCP_SERVER_SEGMENT_MAX_LENGTH,
    "server"
  );
  return `mcp__${segment}`;
}

export function buildMcpToolRuntimeName(
  serverName: string,
  toolName: string
): string {
  const server = buildMcpServerRuntimeName(serverName);
  const tool = shortenMcpNameSegment(
    normalizeMcpNameSegment(toolName, "tool"),
    MCP_TOOL_NAME_MAX_LENGTH - server.length - 2,
    "tool"
  );
  return `${server}__${tool}`;
}
