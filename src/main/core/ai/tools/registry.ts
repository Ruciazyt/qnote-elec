import type { ToolDefinition } from "./tool";
import { GITLAB_READ_TOOLS, GITLAB_WRITE_TOOLS } from './gitlab/index';
import { isGitlabConfigured } from './gitlab/index';
import { configureQNoteGitlabAdapter } from './gitlabQnoteAdapter';
import { GITHUB_READ_TOOLS, GITHUB_WRITE_TOOLS } from './github/index';
import { isGithubConfigured } from './github/index';
import { configureQNoteGithubAdapter } from './githubQnoteAdapter';
import { READ_TOOLS, WRITE_TOOLS } from './catalog';
import { isToolEnabled } from './toolToggle';
import { mcpManager } from '../mcp/manager';

configureQNoteGitlabAdapter();
configureQNoteGithubAdapter();

export { READ_TOOLS, WRITE_TOOLS };

export function getEnabledTools(): ToolDefinition[] {
  const gitlabTools = isGitlabConfigured()
    ? [...GITLAB_READ_TOOLS, ...GITLAB_WRITE_TOOLS]
    : [];
  const githubTools = isGithubConfigured()
    ? [...GITHUB_READ_TOOLS, ...GITHUB_WRITE_TOOLS]
    : [];
  return [
    ...READ_TOOLS,
    ...WRITE_TOOLS,
    ...gitlabTools,
    ...githubTools,
    ...mcpManager.getTools(),
  ].filter((tool) => isToolEnabled(tool.name));
}

export async function prepareEnabledTools(): Promise<ToolDefinition[]> {
  await mcpManager.ensureToolsReady();
  return getEnabledTools();
}

export function getAllToolNames(): string[] {
  return getEnabledTools().map((t) => t.name);
}
