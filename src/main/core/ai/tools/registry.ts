
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getClipboardHistoryTool } from './getClipboard';
import { getTodosTool } from './getTodos';
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
  rememberTool,
  forgetTool,
  browserClickTool,
  browserFillTool,
  browserNavigateTool,
];

export function getEnabledTools(): StructuredToolInterface[] {
  return [...READ_TOOLS, ...WRITE_TOOLS, ...mcpManager.getTools()];
}

export async function prepareEnabledTools(): Promise<StructuredToolInterface[]> {
  await mcpManager.ensureToolsReady();
  return getEnabledTools();
}

export function getAllToolNames(): string[] {
  return getEnabledTools().map((t) => t.name);
}
