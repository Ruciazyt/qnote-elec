export interface GithubConfig {
  baseUrl: string;
  token: string;
  allowedRepositories: string[];
  readOnly: boolean;
  maxResultTokens: number;
  requestTimeoutMs: number;
}

export interface GithubLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GithubToolkitOptions {
  config?: GithubConfig | (() => GithubConfig);
  logger?: GithubLogger;
  writeOverflow?: (label: string, content: string) => Promise<string>;
}

export type GithubToolResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: string;
    };
