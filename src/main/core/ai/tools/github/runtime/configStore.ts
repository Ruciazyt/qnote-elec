import type { Knex } from 'knex';
import { log } from '../../../../system/log';
import { setGithubRuntimeConfig } from './runtime';
import { getEnvironmentGithubConfig } from './config';

const SETTINGS_KEY = 'github_config';

export interface StoredGithubConfig {
  baseUrl: string;
  token: string;
  allowedRepositories: string[];
  readOnly: boolean;
}

let db: Knex | null = null;

export async function loadGithubConfig(): Promise<StoredGithubConfig | null> {
  if (!db) return null;
  try {
    const row = await db('settings').where('configName', SETTINGS_KEY).first();
    if (!row?.configValue) return null;
    const parsed = JSON.parse(row.configValue);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      allowedRepositories: Array.isArray(parsed.allowedRepositories)
        ? parsed.allowedRepositories.filter((item) => typeof item === 'string')
        : [],
      readOnly: parsed.readOnly === true,
    };
  } catch (err) {
    log.error('[github] 读取配置失败', err);
    return null;
  }
}

export async function saveGithubConfig(config: StoredGithubConfig): Promise<void> {
  if (!db) throw new Error('GitHub 配置存储未初始化');
  const now = new Date();
  const value = JSON.stringify(config);
  const exist = await db('settings').where('configName', SETTINGS_KEY).first();
  if (exist) {
    await db('settings')
      .where('configName', SETTINGS_KEY)
      .update({ configValue: value, updated_at: now });
  } else {
    await db('settings').insert({
      configName: SETTINGS_KEY,
      configValue: value,
      created_at: now,
      updated_at: now,
    });
  }
  applyGithubConfig(config);
}

export async function clearGithubConfig(): Promise<void> {
  if (!db) throw new Error('GitHub 配置存储未初始化');
  setGithubRuntimeConfig(undefined);
  await db('settings').where('configName', SETTINGS_KEY).delete();
}

export function applyGithubConfig(config: StoredGithubConfig): void {
  const fallback = getEnvironmentGithubConfig();
  setGithubRuntimeConfig({
    baseUrl: config.baseUrl.trim() || fallback.baseUrl,
    token: config.token,
    allowedRepositories: config.allowedRepositories,
    readOnly: config.readOnly,
    maxResultTokens: 4000,
    requestTimeoutMs: 30000,
  });
}

export async function initGithubConfigStore(DB: Knex): Promise<void> {
  db = DB;
  const stored = await loadGithubConfig();
  if (stored) applyGithubConfig(stored);
}
