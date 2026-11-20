export interface GitlabProject {
  id: number;
  path_with_namespace: string;
  default_branch?: string;
  last_activity_at?: string;
  visibility?: string;
  web_url?: string;
}

export interface GitlabBranch {
  name: string;
  protected: boolean;
  default: boolean;
  commit?: { id: string; short_id: string; title: string; committed_date: string };
}

export interface GitlabCommit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
  web_url?: string;
}

export interface GitlabIssue {
  iid: number;
  title: string;
  description?: string;
  state: string;
  labels?: string[];
  author?: { username?: string; name?: string };
  assignees?: Array<{ username?: string; name?: string }>;
  created_at?: string;
  updated_at?: string;
  web_url?: string;
}

export interface GitlabNote {
  id: number;
  body: string;
  author?: { username?: string; name?: string };
  created_at?: string;
  system?: boolean;
}

export interface GitlabMergeRequest {
  iid: number;
  title: string;
  description?: string;
  state: string;
  source_branch: string;
  target_branch: string;
  draft?: boolean;
  merge_status?: string;
  detailed_merge_status?: string;
  author?: { username?: string; name?: string };
  created_at?: string;
  updated_at?: string;
  web_url?: string;
  sha?: string;
}

export interface GitlabPipeline {
  id: number;
  ref: string;
  status: string;
  source: string;
  sha?: string;
  created_at?: string;
  updated_at?: string;
  duration?: number;
  web_url?: string;
}

export interface GitlabJob {
  id: number;
  name: string;
  stage: string;
  status: string;
  duration?: number;
  allow_failure?: boolean;
  web_url?: string;
}
