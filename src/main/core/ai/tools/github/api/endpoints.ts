export function encodeRepositoryId(repository: string): string {
  const raw = String(repository).trim();
  if (/^\d+$/.test(raw)) return raw;
  return raw
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function repositoryPath(repository: string): string {
  return '/repos/' + encodeRepositoryId(repository);
}

export const githubEndpoints = {
  user: () => '/user',
  rateLimit: () => '/rate_limit',
  repositories: () => '/user/repos',
  repository: (repository: string) => repositoryPath(repository),
  branches: (repository: string) => repositoryPath(repository) + '/branches',
  branch: (repository: string, branch: string) =>
    repositoryPath(repository) + '/branches/' + encodeURIComponent(branch),
  commits: (repository: string) => repositoryPath(repository) + '/commits',
  gitCommit: (repository: string, ref: string) =>
    repositoryPath(repository) + '/git/commits/' + encodeURIComponent(ref),
  gitCommits: (repository: string) => repositoryPath(repository) + '/git/commits',
  gitBlobs: (repository: string) => repositoryPath(repository) + '/git/blobs',
  gitTrees: (repository: string) => repositoryPath(repository) + '/git/trees',
  gitRefs: (repository: string) => repositoryPath(repository) + '/git/refs',
  gitRef: (repository: string, branch: string) =>
    repositoryPath(repository) + '/git/refs/heads/' + encodeURIComponent(branch),
  issues: (repository: string) => repositoryPath(repository) + '/issues',
  issue: (repository: string, number: number) => repositoryPath(repository) + '/issues/' + number,
  issueComments: (repository: string, number: number) =>
    repositoryPath(repository) + '/issues/' + number + '/comments',
  pullRequests: (repository: string) => repositoryPath(repository) + '/pulls',
  pullRequest: (repository: string, number: number) =>
    repositoryPath(repository) + '/pulls/' + number,
  mergePullRequest: (repository: string, number: number) =>
    repositoryPath(repository) + '/pulls/' + number + '/merge',
  workflowRuns: (repository: string) => repositoryPath(repository) + '/actions/runs',
  workflowRun: (repository: string, runId: number) =>
    repositoryPath(repository) + '/actions/runs/' + runId,
  workflowJobs: (repository: string, runId: number) =>
    repositoryPath(repository) + '/actions/runs/' + runId + '/jobs',
  jobLogs: (repository: string, jobId: number) =>
    repositoryPath(repository) + '/actions/jobs/' + jobId + '/logs',
} as const;
