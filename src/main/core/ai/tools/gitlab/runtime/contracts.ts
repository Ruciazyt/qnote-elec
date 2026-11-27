export interface GitlabConfig {
  baseUrl: string;
  token: string;
  allowedProjects: string[];
  readOnly: boolean;
  expectedVersion: string | null;
  maxResultTokens: number;
  requestTimeoutMs: number;
}

export interface GitlabLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GitlabToolkitOptions {
  config?: GitlabConfig | (() => GitlabConfig);
  logger?: GitlabLogger;
  writeOverflow?: (label: string, content: string) => Promise<string>;
}

export type GitlabToolResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: string;
    };
