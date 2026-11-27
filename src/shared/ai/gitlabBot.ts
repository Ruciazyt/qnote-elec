export interface GitlabBotConfigView {
  enabled: boolean;
  port: number;
  bindAddress: string;
  signingTokenHint: string;
  secretTokenHint: string;
  relayTokenHint: string;
  triggerWords: string[];
  allowedProjects: string[];
  runnerEnabled: boolean;
  runnerProject: string;
  runnerTags: string[];
}

export interface GitlabBotStatus {
  running: boolean;
  port: number;
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
  port?: number;
  bindAddress?: string;
  signingToken?: string;
  secretToken?: string;
  relayToken?: string;
  triggerWords?: string[];
  allowedProjects?: string[];
  runnerEnabled?: boolean;
  runnerProject?: string;
  runnerTags?: string[];
}
