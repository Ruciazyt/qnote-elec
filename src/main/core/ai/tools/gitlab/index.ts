import type { StructuredToolInterface } from '@langchain/core/tools';
import {
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabListBranchesTool,
  gitlabListProjectsTool,
} from './projectTools';
import { gitlabCommitFilesTool, gitlabListCommitsTool } from './commitTools';
import {
  gitlabAddCommentTool,
  gitlabCreateIssueTool,
  gitlabGetIssueTool,
  gitlabListIssuesTool,
  gitlabUpdateIssueTool,
} from './issueTools';
import {
  gitlabCreateMergeRequestTool,
  gitlabListMergeRequestsTool,
  gitlabMergeMergeRequestTool,
  gitlabUpdateMergeRequestTool,
} from './mergeRequestTools';
import {
  gitlabGetJobLogsTool,
  gitlabGetPipelineTool,
  gitlabListPipelinesTool,
} from './pipelineTools';

export const GITLAB_READ_TOOLS: StructuredToolInterface[] = [
  gitlabListProjectsTool,
  gitlabListBranchesTool,
  gitlabListCommitsTool,
  gitlabListIssuesTool,
  gitlabGetIssueTool,
  gitlabListMergeRequestsTool,
  gitlabListPipelinesTool,
  gitlabGetPipelineTool,
  gitlabGetJobLogsTool,
];

export const GITLAB_WRITE_TOOLS: StructuredToolInterface[] = [
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabCommitFilesTool,
  gitlabCreateIssueTool,
  gitlabUpdateIssueTool,
  gitlabAddCommentTool,
  gitlabCreateMergeRequestTool,
  gitlabUpdateMergeRequestTool,
  gitlabMergeMergeRequestTool,
];

export { isGitlabConfigured } from './config';

export {
  gitlabCreateBranchTool,
  gitlabDeleteBranchTool,
  gitlabListBranchesTool,
  gitlabListProjectsTool,
} from './projectTools';
export { gitlabCommitFilesTool, gitlabListCommitsTool } from './commitTools';
export {
  gitlabAddCommentTool,
  gitlabCreateIssueTool,
  gitlabGetIssueTool,
  gitlabListIssuesTool,
  gitlabUpdateIssueTool,
} from './issueTools';
export {
  gitlabCreateMergeRequestTool,
  gitlabListMergeRequestsTool,
  gitlabMergeMergeRequestTool,
  gitlabUpdateMergeRequestTool,
} from './mergeRequestTools';
export {
  gitlabGetJobLogsTool,
  gitlabGetPipelineTool,
  gitlabListPipelinesTool,
} from './pipelineTools';
