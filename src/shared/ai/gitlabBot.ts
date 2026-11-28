export const GITLAB_RUNNER_DEFAULT_TAGS = ["qnote"];

export function resolveRunnerTags(tags: string[] | undefined): string[] {
  const list = (tags ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return list.length ? list : [...GITLAB_RUNNER_DEFAULT_TAGS];
}

export interface GitlabBotConfigView {
  enabled: boolean;
  triggerWords: string[];
  allowedProjects: string[];
  runnerEnabled: boolean;
  runnerProject: string;
}

export interface GitlabBotStatus {
  running: boolean;
  url: string;
}

export interface GitlabRunnerStatusView {
  running: boolean;
  pid: number;
  enabled: boolean;
  project: string;
  tags: string[];
  binaryPath: string;
  configPath: string;
  restarts: number;
  lastError: string;
}

export interface GitlabBotConfigPayload {
  enabled?: boolean;
  triggerWords?: string[];
  allowedProjects?: string[];
  runnerEnabled?: boolean;
  runnerProject?: string;
}
