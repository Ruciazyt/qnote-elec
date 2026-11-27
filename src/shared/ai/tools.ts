export type BuiltinToolKind = "read" | "write";

/** QNote 自己的 MCP server 名；opencode 会给它的工具加上这个前缀 */
export const QNOTE_MCP_SERVER_NAME = "qnote";
export const QNOTE_MCP_TOOL_PREFIX = `${QNOTE_MCP_SERVER_NAME}_`;

export interface BuiltinToolInfo {
  name: string;
  title: string;
  description: string;
  group: string;
  kind: BuiltinToolKind;
}

export interface BuiltinToolState extends BuiltinToolInfo {
  enabled: boolean;
  note?: string;
}

export interface GitlabToolConfig {
  baseUrl: string;
  allowedProjects: string[];
  readOnly: boolean;
  expectedVersion: string | null;
  hasToken: boolean;
  tokenHint: string;
  configured: boolean;
}

export interface GitlabToolConfigInput {
  baseUrl: string;
  token?: string;
  allowedProjects: string[];
  readOnly: boolean;
  expectedVersion?: string | null;
}

export interface GithubToolConfig {
  baseUrl: string;
  allowedRepositories: string[];
  readOnly: boolean;
  hasToken: boolean;
  tokenHint: string;
  configured: boolean;
}

export interface GithubToolConfigInput {
  baseUrl: string;
  token?: string;
  allowedRepositories: string[];
  readOnly: boolean;
}
