export type PluginPreviewSpec =
  | { type: "port"; port: number }
  | { type: "url"; url: string }
  | { type: "path"; path: string };

export interface PluginRuntimeConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  preview?: PluginPreviewSpec;
}

export type PluginDataAccess = "none" | "read" | "write";

export interface PluginCapabilities {
  process?: {
    spawn?: boolean;
    env?: string[];
  };
  network?: string[];
  filesystem?: {
    read?: string[];
    write?: string[];
  };
  qnote?: {
    notes?: PluginDataAccess;
    todos?: PluginDataAccess;
    clipboard?: PluginDataAccess;
    ai?: PluginDataAccess;
  };
}

export interface PluginCommandContribution {
  command: string;
  title: string;
  category?: string;
  icon?: string;
}

export interface PluginCommandEntry {
  command: string;
  title: string;
  category?: string;
  pluginId: string;
}

export interface PluginSettingValue {
  key: string;
  value: string | null;
}

export interface PluginNotification {
  pluginId: string;
  level: string;
  message: string;
}

export interface PluginSettingContribution {
  key: string;
  type: "string" | "number" | "boolean";
  default?: string | number | boolean;
  title?: string;
  description?: string;
}

export interface PluginSidebarContribution {
  id: string;
  title: string;
  icon?: string;
}

export interface PluginContributes {
  commands?: PluginCommandContribution[];
  settings?: PluginSettingContribution[];
  sidebar?: PluginSidebarContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description?: string;
  license?: string;
  icon?: string;
  engines: { qnote: string };
  activationEvents?: string[];
  runtime: PluginRuntimeConfig;
  capabilities?: PluginCapabilities;
  contributes?: PluginContributes;
  extensionDependencies?: string[];
}

export type PluginStatus =
  | "ready"
  | "missing-manifest"
  | "invalid-manifest"
  | "incompatible";

export type PluginOrigin = "local" | "market";

export interface PluginRecord {
  localId: number;
  id: string;
  name: string;
  version: string;
  publisher: string;
  description?: string;
  path: string;
  status: PluginStatus;
  manifestText?: string;
  command?: string;
  preview?: string;
  error?: string;
  origin: PluginOrigin;
  enabled: boolean;
  confirmedManifestHash?: string;
  runtime?: PluginRuntimeConfig;
  capabilities?: PluginCapabilities;
  contributes?: PluginContributes;
}

export type PluginRunStatus =
  | "stopped"
  | "starting"
  | "running"
  | "exited"
  | "failed";

export interface PluginRuntimeState {
  pluginId: string;
  status: PluginRunStatus;
  pid?: number;
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type PluginLogStream = "stdout" | "stderr" | "system";

export interface PluginLogLine {
  pluginId: string;
  stream: PluginLogStream;
  text: string;
  at: number;
}

export type PluginImportFailureReason =
  | "not-a-directory"
  | "missing-manifest"
  | "invalid-manifest"
  | "already-imported"
  | "duplicate-id";

export interface PluginImportResult {
  ok: boolean;
  error?: string;
  reason?: PluginImportFailureReason;
  plugin?: PluginRecord;
}

export interface MarketImportPayload extends Partial<PluginManifest> {
  bundle?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  preview?: PluginPreviewSpec;
}

export interface PluginManifestDraft {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  publisher?: string;
  license?: string;
  icon?: string;
  engines?: { qnote?: string };
  activationEvents?: string[];
  runtime?: PluginRuntimeConfig;
  capabilities?: PluginCapabilities;
  contributes?: PluginContributes;
  extensionDependencies?: string[];
}

export interface StartConfirmation {
  pluginId: string;
  name: string;
  commandLine: string;
  origin: PluginOrigin;
  risk: import("./pluginRisk").RiskReport;
  manifestHash: string;
  sourceLabel?: string;
  capabilities?: PluginCapabilities;
}
