import { z } from 'zod';
import type { GithubConfig } from './contracts';
import { getRuntimeGithubConfig } from './runtime';

export { type GithubConfig } from './contracts';

const githubConfigSchema = z.object({
  baseUrl: z.string().trim(),
  token: z.string().trim(),
  allowedRepositories: z.array(z.string().trim().min(1)),
  readOnly: z.boolean(),
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

export function getEnvironmentGithubConfig(): GithubConfig {
  const envBase = process.env.GITHUB_BASE_URL;
  const envToken = process.env.GITHUB_TOKEN;
  const envAllowed = process.env.GITHUB_ALLOWED_REPOSITORIES;
  const envReadOnly = process.env.GITHUB_READ_ONLY;

  let baseUrl = (envBase ?? 'https://api.github.com').trim();
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const token = (envToken ?? '').trim();
  const allowedRepositories =
    envAllowed !== undefined ? readEnvList('GITHUB_ALLOWED_REPOSITORIES') : [];
  const readOnly = envReadOnly !== undefined
    ? /^(1|true|yes|on)$/i.test(envReadOnly.trim())
    : false;

  return githubConfigSchema.parse({
    baseUrl,
    token,
    allowedRepositories,
    readOnly,
    maxResultTokens: 4000,
    requestTimeoutMs: 30000,
  });
}

export function getGithubConfig(): GithubConfig {
  return githubConfigSchema.parse(
    getRuntimeGithubConfig() ?? getEnvironmentGithubConfig()
  );
}

export function isGithubConfigured(): boolean {
  const cfg = getGithubConfig();
  return cfg.baseUrl.length > 0 && cfg.token.length > 0;
}

export function resetGithubConfig(): void {
}
