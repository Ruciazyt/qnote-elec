import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildAgentProfile,
  buildCodeAgentProfile,
  QNOTE_AGENT_NAME,
  QNOTE_CODE_AGENT_NAME,
  QNOTE_MCP_SERVER_NAME,
} from "./profile";

export const OPENCODE_SCHEMA = "https://opencode.ai/config.json";
const OPENCODE_CONFIG_RELATIVE_PATH = "opencode.json";
const OPENCODE_AGENT_DIR_RELATIVE_PATH = path.join(".opencode", "agents");

export interface OpencodeProviderEntry {
  id: string;
  npm: string;
  name: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface OpencodeWorkspaceOptions {
  directory: string;
  mcpUrl: string;
  mcpToken: string;
  provider?: OpencodeProviderEntry;
  systemPrompt?: string;
  codeSystemPrompt?: string;
}

export interface OpencodeWorkspaceFiles {
  configJson: string;
  agentMarkdown: string;
  codeAgentMarkdown: string;
}

export interface OpencodeWorkspaceConfig {
  $schema: string;
  provider?: Record<string, unknown>;
  mcp: Record<string, unknown>;
  experimental: Record<string, unknown>;
}

export function buildProviderEntry(
  provider: OpencodeProviderEntry
): Record<string, unknown> {
  const options: Record<string, unknown> = { apiKey: provider.apiKey };
  if (provider.baseURL) options.baseURL = provider.baseURL;
  return {
    npm: provider.npm,
    name: provider.name,
    options,
    models: {
      [provider.model]: { name: provider.model },
    },
  };
}

export function buildWorkspaceConfig(
  options: OpencodeWorkspaceOptions
): OpencodeWorkspaceConfig {
  const config: OpencodeWorkspaceConfig = {
    $schema: OPENCODE_SCHEMA,
    mcp: {
      [QNOTE_MCP_SERVER_NAME]: {
        type: "remote",
        url: options.mcpUrl,
        headers: { Authorization: `Bearer ${options.mcpToken}` },
        enabled: true,
      },
    },
    experimental: {
      continue_loop_on_deny: true,
    },
  };
  if (options.provider) {
    config.provider = { [options.provider.id]: buildProviderEntry(options.provider) };
  }
  return config;
}

export function agentFilePath(
  directory: string,
  agentName: string = QNOTE_AGENT_NAME
): string {
  return path.join(directory, OPENCODE_AGENT_DIR_RELATIVE_PATH, `${agentName}.md`);
}

export function configFilePath(directory: string): string {
  return path.join(directory, OPENCODE_CONFIG_RELATIVE_PATH);
}

export function buildOpencodeWorkspace(
  options: OpencodeWorkspaceOptions
): OpencodeWorkspaceFiles {
  return {
    configJson: `${JSON.stringify(buildWorkspaceConfig(options), null, 2)}\n`,
    agentMarkdown: buildAgentProfile({ systemPrompt: options.systemPrompt }).markdown,
    codeAgentMarkdown: buildCodeAgentProfile({
      systemPrompt: options.codeSystemPrompt,
    }).markdown,
  };
}

export interface OpencodeWorkspaceWriteResult {
  configPath: string;
  agentPaths: string[];
  configChanged: boolean;
  agentChanged: boolean;
}

export function writeOpencodeWorkspace(
  directory: string,
  configJson: string,
  agents: Record<string, string>
): OpencodeWorkspaceWriteResult {
  const configPath = configFilePath(directory);
  const configChanged = writeIfChanged(configPath, configJson);
  const agentPaths: string[] = [];
  let agentChanged = false;
  for (const [agentName, markdown] of Object.entries(agents)) {
    const agentPath = agentFilePath(directory, agentName);
    agentPaths.push(agentPath);
    if (writeIfChanged(agentPath, markdown)) agentChanged = true;
  }
  return { configPath, agentPaths, configChanged, agentChanged };
}

export function writeWorkspaceToDirectory(
  directory: string,
  files: OpencodeWorkspaceFiles
): boolean {
  if (!directory || !fs.existsSync(directory)) return false;
  writeOpencodeWorkspace(directory, files.configJson, {
    [QNOTE_AGENT_NAME]: files.agentMarkdown,
    [QNOTE_CODE_AGENT_NAME]: files.codeAgentMarkdown,
  });
  excludeFromGit(directory, ["/opencode.json", "/.opencode/"]);
  return true;
}

export function excludeFromGit(directory: string, entries: string[]): void {
  const gitDir = resolveGitDir(directory);
  if (!gitDir) return;
  const excludePath = path.join(gitDir, "info", "exclude");
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const current = fs.existsSync(excludePath)
      ? fs.readFileSync(excludePath, "utf8")
      : "";
    const missing = entries.filter((entry) => !current.includes(entry));
    if (!missing.length) return;
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(
      excludePath,
      prefix + "# QNote opencode workspace\n" + missing.join("\n") + "\n",
      "utf8"
    );
  } catch {
    // 写不进去就算了，不影响主流程
  }
}

function resolveGitDir(directory: string): string | null {
  const gitPath = path.join(directory, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    if (stat.isFile()) {
      const line = fs
        .readFileSync(gitPath, "utf8")
        .split(/\r?\n/)
        .find((item) => item.startsWith("gitdir:"));
      if (!line) return null;
      const target = line.slice("gitdir:".length).trim();
      if (!target) return null;
      return path.isAbsolute(target) ? target : path.resolve(directory, target);
    }
  } catch {
    return null;
  }
  return null;
}

function writeIfChanged(filePath: string, content: string): boolean {
  try {
    if (fs.readFileSync(filePath, "utf8") === content) return false;
  } catch {
    // 文件不存在或读不了，直接写
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}
