import type { ToolDefinition } from "../tool";
import type { GitlabToolkitOptions } from './runtime/contracts';
import { isGitlabConfigured } from './runtime/config';
import { configureGitlabToolkit } from './runtime/runtime';
import {
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabListBranchesTool,
  gitlabListProjectsTool,
} from './tools/project';
import { gitlabCommitFilesTool, gitlabListCommitsTool } from './tools/commit';
import {
  gitlabAddCommentTool,
  gitlabCreateIssueTool,
  gitlabGetIssueTool,
  gitlabListIssuesTool,
  gitlabUpdateIssueTool,
} from './tools/issue';
import {
  gitlabCreateMergeRequestTool,
  gitlabListMergeRequestsTool,
  gitlabMergeMergeRequestTool,
  gitlabUpdateMergeRequestTool,
} from './tools/mergeRequest';
import {
  gitlabGetJobLogsTool,
  gitlabGetPipelineTool,
  gitlabListPipelinesTool,
} from './tools/pipeline';
import {
  gitlabCreateHookTool,
  gitlabDeleteHookTool,
  gitlabEnsureWebhookTool,
  gitlabListHooksTool,
  gitlabTestHookTool,
  gitlabUpdateHookTool,
} from './tools/hook';
import { gitlabGatewayStatusTool } from './tools/gateway';
import { gitlabEnsureRunnerTool } from './tools/runner';

export const GITLAB_READ_TOOLS: ToolDefinition[] = [
  gitlabListProjectsTool,
  gitlabListBranchesTool,
  gitlabListCommitsTool,
  gitlabListIssuesTool,
  gitlabGetIssueTool,
  gitlabListMergeRequestsTool,
  gitlabListPipelinesTool,
  gitlabGetPipelineTool,
  gitlabGetJobLogsTool,
  gitlabListHooksTool,
  gitlabGatewayStatusTool,
];

export const GITLAB_WRITE_TOOLS: ToolDefinition[] = [
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabCommitFilesTool,
  gitlabCreateIssueTool,
  gitlabUpdateIssueTool,
  gitlabAddCommentTool,
  gitlabCreateMergeRequestTool,
  gitlabUpdateMergeRequestTool,
  gitlabMergeMergeRequestTool,
  gitlabCreateHookTool,
  gitlabUpdateHookTool,
  gitlabDeleteHookTool,
  gitlabTestHookTool,
  gitlabEnsureWebhookTool,
  gitlabEnsureRunnerTool,
];

export { configureGitlabToolkit, resetGitlabRuntime } from './runtime/runtime';
export type {
  GitlabConfig,
  GitlabLogger,
  GitlabToolResult,
  GitlabToolkitOptions,
} from './runtime/contracts';
export { isGitlabConfigured } from './runtime/config';
export {
  branchSchema,
  cursorSchema,
  issueIidSchema,
  limitSchema,
  projectSchema,
  searchSchema,
  stateSchema,
  strictObject,
} from './schemas/input';
export type * from './api/types';
export { gitlabEndpoints } from './api/endpoints';

export interface GitlabToolkit {
  readTools: ToolDefinition[];
  writeTools: ToolDefinition[];
  allTools: ToolDefinition[];
  isConfigured(): boolean;
}

export function createGitlabToolkit(
  options: GitlabToolkitOptions = {}
): GitlabToolkit {
  if (Object.keys(options).length > 0) {
    configureGitlabToolkit(options);
  }
  return {
    readTools: [...GITLAB_READ_TOOLS],
    writeTools: [...GITLAB_WRITE_TOOLS],
    allTools: [...GITLAB_READ_TOOLS, ...GITLAB_WRITE_TOOLS],
    isConfigured: isGitlabConfigured,
  };
}

export {
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabListBranchesTool,
  gitlabListProjectsTool,
} from './tools/project';
export { gitlabCommitFilesTool, gitlabListCommitsTool } from './tools/commit';
export {
  gitlabAddCommentTool,
  gitlabCreateIssueTool,
  gitlabGetIssueTool,
  gitlabListIssuesTool,
  gitlabUpdateIssueTool,
} from './tools/issue';
export {
  gitlabCreateMergeRequestTool,
  gitlabListMergeRequestsTool,
  gitlabMergeMergeRequestTool,
  gitlabUpdateMergeRequestTool,
} from './tools/mergeRequest';
export {
  gitlabGetJobLogsTool,
  gitlabGetPipelineTool,
  gitlabListPipelinesTool,
} from './tools/pipeline';
export {
  gitlabCreateHookTool,
  gitlabDeleteHookTool,
  gitlabListHooksTool,
  gitlabTestHookTool,
  gitlabUpdateHookTool,
} from './tools/hook';
export { gitlabGatewayStatusTool } from './tools/gateway';
export { gitlabEnsureRunnerTool } from './tools/runner';
