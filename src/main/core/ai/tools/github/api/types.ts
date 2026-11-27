export interface GitHubRepository {
  id: number;
  full_name: string;
  name?: string;
  owner?: { login: string };
  default_branch?: string | null;
  private?: boolean;
  html_url?: string;
  updated_at?: string;
  pushed_at?: string;
}

export interface GitHubBranch {
  name: string;
  protected?: boolean;
  commit?: { sha: string; url?: string };
}

export interface GitHubCommit {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string } | null;
  };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: Array<{ name?: string }>;
  user?: { login?: string };
  assignees?: Array<{ login?: string }>;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  pull_request?: unknown;
}

export interface GitHubComment {
  id: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  user?: { login?: string };
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  run_number?: number;
  head_branch?: string | null;
  head_sha?: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

export interface GitHubJob {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string;
  completed_at?: string;
  html_url?: string;
  steps?: Array<{ name?: string; status?: string; conclusion?: string | null; number?: number }>;
}
