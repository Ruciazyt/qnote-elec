import { z } from 'zod';
import type { GitlabConfig } from './contracts';
import { getRuntimeGitlabConfig } from './runtime';

export { type GitlabConfig } from './contracts';

const gitlabConfigSchema = z.object({
  baseUrl: z.string().trim(),
  token: z.string().trim(),
  allowedProjects: z.array(z.string().trim().min(1)),
  readOnly: z.boolean(),
  expectedVersion: z.string().trim().nullable(),
  maxResultTokens: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive(),
});

function readEnvList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getEnvironmentGitlabConfig(): GitlabConfig {
  const envBase = process.env.GITLAB_BASE_URL;
  const envToken = process.env.GITLAB_TOKEN;
  const envAllowed = process.env.GITLAB_ALLOWED_PROJECTS;
  const envReadOnly = process.env.GITLAB_READ_ONLY;
  const envVersion = process.env.GITLAB_EXPECTED_VERSION;

  let baseUrl = (envBase ?? '').trim();
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const token = (envToken ?? '').trim();
  const allowedProjects = envAllowed !== undefined ? readEnvList('GITLAB_ALLOWED_PROJECTS') : [];
  const readOnly = envReadOnly !== undefined
    ? /^(1|true|yes|on)$/i.test(envReadOnly.trim())
    : false;
  const expectedVersion = (envVersion ?? '19.2').trim() || null;

  const parsed = gitlabConfigSchema.parse({
    baseUrl,
    token,
    allowedProjects,
    readOnly,
    expectedVersion,
    maxResultTokens: 4000,
    requestTimeoutMs: 30000,
  });
  return { ...parsed, expectedVersion: parsed.expectedVersion ?? null };
}

export function getGitlabConfig(): GitlabConfig {
  const parsed = gitlabConfigSchema.parse(
    getRuntimeGitlabConfig() ?? getEnvironmentGitlabConfig()
  );
  return { ...parsed, expectedVersion: parsed.expectedVersion ?? null };
}

export function isGitlabConfigured(): boolean {
  const cfg = getGitlabConfig();
  return cfg.baseUrl.length > 0 && cfg.token.length > 0;
}

export function resetGitlabConfig(): void {
  // 保留给测试与调用方；环境配置现在按需读取。
}