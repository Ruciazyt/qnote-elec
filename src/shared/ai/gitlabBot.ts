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
