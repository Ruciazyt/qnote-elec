export function encodeProjectId(project: string | number): string {
  const raw = String(project).trim();
  if (/^\d+$/.test(raw)) return raw;
  return encodeURIComponent(raw);
}

function projectPath(project: string): string {
  return '/projects/' + encodeProjectId(project);
}

function repositoryPath(project: string): string {
  return projectPath(project) + '/repository';
}

function issuePath(project: string, iid: number): string {
  return projectPath(project) + '/issues/' + iid;
}

function mergeRequestPath(project: string, iid: number): string {
  return projectPath(project) + '/merge_requests/' + iid;
}

export const gitlabEndpoints = {
  version: () => '/version',
  user: () => '/user',
  projects: () => '/projects',
  branches: (project: string) => repositoryPath(project) + '/branches',
  branch: (project: string, branch: string) =>
    repositoryPath(project) + '/branches/' + encodeURIComponent(branch),
  commits: (project: string) => repositoryPath(project) + '/commits',
  issues: (project: string) => projectPath(project) + '/issues',
  issue: issuePath,
  issueNotes: (project: string, iid: number) => issuePath(project, iid) + '/notes',
  issueNote: (project: string, iid: number, noteId: number) =>
    issuePath(project, iid) + '/notes/' + noteId,
  mergeRequestNote: (project: string, iid: number, noteId: number) =>
    mergeRequestPath(project, iid) + '/notes/' + noteId,
  mergeRequests: (project: string) => projectPath(project) + '/merge_requests',
  mergeRequest: mergeRequestPath,
  mergeMergeRequest: (project: string, iid: number) =>
    mergeRequestPath(project, iid) + '/merge',
  pipelines: (project: string) => projectPath(project) + '/pipelines',
  pipeline: (project: string, pipelineId: number) =>
    projectPath(project) + '/pipelines/' + pipelineId,
  pipelineJobs: (project: string, pipelineId: number) =>
    projectPath(project) + '/pipelines/' + pipelineId + '/jobs',
  jobTrace: (project: string, jobId: number) =>
    projectPath(project) + '/jobs/' + jobId + '/trace',
  hooks: (project: string) => projectPath(project) + '/hooks',
  hook: (project: string, hookId: number) =>
    projectPath(project) + '/hooks/' + hookId,
  hookTest: (project: string, hookId: number, trigger: string) =>
    projectPath(project) + '/hooks/' + hookId + '/test/' + trigger,
  triggers: (project: string) => projectPath(project) + '/triggers',
  trigger: (project: string, triggerId: number) =>
    projectPath(project) + '/triggers/' + triggerId,
  variables: (project: string) => projectPath(project) + '/variables',
  variable: (project: string, key: string) =>
    projectPath(project) + '/variables/' + encodeURIComponent(key),
  runners: (project: string) => projectPath(project) + '/runners',
  runner: (runnerId: number) => '/runners/' + runnerId,
  userRunners: () => '/user/runners',
  runnerResetToken: (runnerId: number) =>
    '/runners/' + runnerId + '/reset_authentication_token',
} as const;
