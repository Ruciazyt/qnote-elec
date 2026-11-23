
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getClipboardHistoryTool } from './getClipboard';
import { getTodosTool } from './getTodos';
import { createTodoTool, updateTodoTool } from './todoTools';
import { getAppInfoTool } from './getAppInfo';
import { saveNoteTool } from './saveNote';
import { listNotesTool } from './listNotes';
import { readNoteTool } from './readNote';
import { rememberTool, recallTool, forgetTool } from './memoryTools';
import { browserGetSnapshotTool } from './browser/browserSnapshot';
import { browserClickTool } from './browser/browserClick';
import { browserFillTool } from './browser/browserFill';
import { browserNavigateTool } from './browser/browserNavigate';
import { webSearchTool } from './web/webSearch';
import { webFetchTool } from './web/webFetch';
import { GITLAB_READ_TOOLS, GITLAB_WRITE_TOOLS } from './gitlab/index';
import { isGitlabConfigured } from './gitlab/config';
import { mcpManager } from '../mcp/manager';

export const READ_TOOLS: StructuredToolInterface[] = [
  getClipboardHistoryTool,
  getTodosTool,
  getAppInfoTool,
  listNotesTool,
  readNoteTool,
  recallTool,
  browserGetSnapshotTool,
  webSearchTool,
  webFetchTool,
];

export const WRITE_TOOLS: StructuredToolInterface[] = [
  saveNoteTool,
  createTodoTool,
  updateTodoTool,
  rememberTool,
  forgetTool,
  browserClickTool,
  browserFillTool,
  browserNavigateTool,
];

export function getEnabledTools(): StructuredToolInterface[] {
  const gitlabTools = isGitlabConfigured()
    ? [...GITLAB_READ_TOOLS, ...GITLAB_WRITE_TOOLS]
    : [];
  return [...READ_TOOLS, ...WRITE_TOOLS, ...gitlabTools, ...mcpManager.getTools()];
}

export async function prepareEnabledTools(): Promise<StructuredToolInterface[]> {
  await mcpManager.ensureToolsReady();
  return getEnabledTools();
}

export function getAllToolNames(): string[] {
  return getEnabledTools().map((t) => t.name);
}
