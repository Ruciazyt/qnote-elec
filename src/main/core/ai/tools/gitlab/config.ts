export interface GitlabConfig {
  baseUrl: string;
  token: string;
  allowedProjects: string[];
  readOnly: boolean;
  expectedVersion: string | null;
  maxResultTokens: number;
  requestTimeoutMs: number;
}

const HARDCODED_BASE_URL = 'https://gitlab.corp.example.com';
const HARDCODED_TOKEN = ''; // NOSONAR 临时写死的 PAT，填入真实值后别提交进仓库
const HARDCODED_ALLOWED_PROJECTS: string[] = [];
const HARDCODED_READ_ONLY = false;
const HARDCODED_EXPECTED_VERSION = '19.2';

let cachedConfig: GitlabConfig | null = null;

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

function readEnvList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getGitlabConfig(): GitlabConfig {
  if (cachedConfig) return cachedConfig;

  const envBase = process.env.GITLAB_BASE_URL;
  const envToken = process.env.GITLAB_TOKEN;
  const envAllowed = process.env.GITLAB_ALLOWED_PROJECTS;
  const envReadOnly = process.env.GITLAB_READ_ONLY;
  const envVersion = process.env.GITLAB_EXPECTED_VERSION;

  const baseUrl = stripTrailingSlashes((envBase || HARDCODED_BASE_URL).trim());
  const token = (envToken || HARDCODED_TOKEN).trim();
  const allowedProjects = envAllowed !== undefined ? readEnvList('GITLAB_ALLOWED_PROJECTS') : HARDCODED_ALLOWED_PROJECTS;
  const readOnly = envReadOnly !== undefined
    ? /^(1|true|yes|on)$/i.test(envReadOnly.trim())
    : HARDCODED_READ_ONLY;
  const expectedVersion = (envVersion !== undefined ? envVersion : HARDCODED_EXPECTED_VERSION).trim() || null;

  cachedConfig = {
    baseUrl,
    token,
    allowedProjects,
    readOnly,
    expectedVersion,
    maxResultTokens: 4000,
    requestTimeoutMs: 30000,
  };
  return cachedConfig;
}

export function isGitlabConfigured(): boolean {
  const cfg = getGitlabConfig();
  return cfg.baseUrl.length > 0 && cfg.token.length > 0;
}

export function resetGitlabConfig(): void {
  cachedConfig = null;
}