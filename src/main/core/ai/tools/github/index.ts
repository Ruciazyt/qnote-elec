import type { ToolDefinition } from "../tool";
import type { GithubToolkitOptions } from './runtime/contracts';
import { isGithubConfigured } from './runtime/config';
import { configureGithubToolkit } from './runtime/runtime';
import {
  githubCreateBranchTool,
  githubDeleteBranchTool,
  githubListBranchesTool,
  githubListRepositoriesTool,
} from './tools/repository';
import { githubCommitFilesTool, githubListCommitsTool } from './tools/commit';
import {
  githubAddCommentTool,
  githubCreateIssueTool,
  githubGetIssueTool,
  githubListIssuesTool,
  githubUpdateIssueTool,
} from './tools/issue';
import {
  githubCreatePullRequestTool,
  githubListPullRequestsTool,
  githubMergePullRequestTool,
  githubUpdatePullRequestTool,
} from './tools/pullRequest';
import {
  githubGetJobLogsTool,
  githubGetWorkflowRunTool,
  githubListWorkflowRunsTool,
} from './tools/workflow';

export const GITHUB_READ_TOOLS: ToolDefinition[] = [
  githubListRepositoriesTool,
  githubListBranchesTool,
  githubListCommitsTool,
  githubListIssuesTool,
  githubGetIssueTool,
  githubListPullRequestsTool,
  githubListWorkflowRunsTool,
  githubGetWorkflowRunTool,
  githubGetJobLogsTool,
];

export const GITHUB_WRITE_TOOLS: ToolDefinition[] = [
  githubCreateBranchTool,
  githubDeleteBranchTool,
  githubCommitFilesTool,
  githubCreateIssueTool,
  githubUpdateIssueTool,
  githubAddCommentTool,
  githubCreatePullRequestTool,
  githubUpdatePullRequestTool,
  githubMergePullRequestTool,
];

export { configureGithubToolkit, resetGithubRuntime } from './runtime/runtime';
export type {
  GithubConfig,
  GithubLogger,
  GithubToolResult,
  GithubToolkitOptions,
} from './runtime/contracts';
export { isGithubConfigured } from './runtime/config';
export {
  branchSchema,
  cursorSchema,
  issueNumberSchema,
  limitSchema,
  repositorySchema,
  searchSchema,
  stateSchema,
  strictObject,
} from './schemas/input';
export type * from './api/types';
export { githubEndpoints } from './api/endpoints';

export interface GithubToolkit {
  readTools: ToolDefinition[];
  writeTools: ToolDefinition[];
  allTools: ToolDefinition[];
  isConfigured(): boolean;
}

export function createGithubToolkit(
  options: GithubToolkitOptions = {}
): GithubToolkit {
  if (Object.keys(options).length > 0) {
    configureGithubToolkit(options);
  }
  return {
    readTools: [...GITHUB_READ_TOOLS],
    writeTools: [...GITHUB_WRITE_TOOLS],
    allTools: [...GITHUB_READ_TOOLS, ...GITHUB_WRITE_TOOLS],
    isConfigured: isGithubConfigured,
  };
}

export {
  githubCreateBranchTool,
  githubDeleteBranchTool,
  githubListBranchesTool,
  githubListRepositoriesTool,
} from './tools/repository';
export { githubCommitFilesTool, githubListCommitsTool } from './tools/commit';
export {
  githubAddCommentTool,
  githubCreateIssueTool,
  githubGetIssueTool,
  githubListIssuesTool,
  githubUpdateIssueTool,
} from './tools/issue';
export {
  githubCreatePullRequestTool,
  githubListPullRequestsTool,
  githubMergePullRequestTool,
  githubUpdatePullRequestTool,
} from './tools/pullRequest';
export {
  githubGetJobLogsTool,
  githubGetWorkflowRunTool,
  githubListWorkflowRunsTool,
} from './tools/workflow';
