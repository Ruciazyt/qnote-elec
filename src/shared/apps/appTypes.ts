
export interface AppManifest {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  preview?: string;
}

export type AppProjectStatus = "ready" | "missing-manifest" | "invalid-manifest";

export type AppOrigin = "local" | "market";

export interface AppProject {
  id: number;
  name: string;
  path: string;
  status: AppProjectStatus;
  manifestText?: string;
  command?: string;
  preview?: string;
  description?: string;
  error?: string;
  origin?: AppOrigin;
  confirmedManifestHash?: string;
}

export interface StartConfirmation {
  projectId: number;
  name: string;
  commandLine: string;
  origin: AppOrigin;
  risk: import("./appRisk").RiskReport;
  manifestHash: string;
  sourceLabel?: string;
}

export type AppImportFailureReason =
  | "not-a-directory"
  | "missing-manifest"
  | "invalid-manifest"
  | "already-imported";

export interface AppImportResult {
  ok: boolean;
  error?: string;
  reason?: AppImportFailureReason;
  project?: AppProject;
}

export type AppRunStatus =
  | "stopped"
  | "starting"
  | "running"
  | "exited"
  | "failed";

export interface AppRuntimeState {
  projectId: number;
  status: AppRunStatus;
  pid?: number;
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type AppLogStream = "stdout" | "stderr" | "system";

export interface AppLogLine {
  projectId: number;
  stream: AppLogStream;
  text: string;
  at: number;
}
