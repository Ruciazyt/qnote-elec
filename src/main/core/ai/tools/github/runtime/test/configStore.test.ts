// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:/tmp',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
}));

import {
  clearGithubConfig,
  initGithubConfigStore,
  loadGithubConfig,
  saveGithubConfig,
  type StoredGithubConfig,
} from '../configStore';
import { isGithubConfigured } from '../../index';
import { resetGithubRuntime } from '../runtime';

const CONFIG: StoredGithubConfig = {
  baseUrl: 'https://api.github.com',
  token: 'ghp-secret',
  allowedRepositories: ['owner/app'],
  readOnly: false,
};

let DB: Knex;

beforeEach(async () => {
  resetGithubRuntime();
  DB = knexFactory({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await DB.schema.createTable('settings', (table) => {
    table.increments('id').primary();
    table.string('configName').notNullable().unique();
    table.string('configValue').notNullable();
    table.timestamp('created_at').defaultTo(DB.fn.now());
    table.timestamp('updated_at').defaultTo(DB.fn.now());
  });
});

afterEach(async () => {
  await DB.destroy();
});

describe('GitHub 配置存储', () => {
  it('没存过配置时返回空', async () => {
    await initGithubConfigStore(DB);
    expect(await loadGithubConfig()).toBeNull();
  });

  it('保存后能读回来', async () => {
    await initGithubConfigStore(DB);
    await saveGithubConfig(CONFIG);
    expect(await loadGithubConfig()).toEqual(CONFIG);
  });

  it('初始化时把存好的配置注入运行时', async () => {
    await initGithubConfigStore(DB);
    await saveGithubConfig(CONFIG);
    await initGithubConfigStore(DB);
    expect(isGithubConfigured()).toBe(true);
  });

  it('保存后立刻生效', async () => {
    await initGithubConfigStore(DB);
    expect(isGithubConfigured()).toBe(false);
    await saveGithubConfig(CONFIG);
    expect(isGithubConfigured()).toBe(true);
  });

  it('清除后配置回到未配置状态', async () => {
    await initGithubConfigStore(DB);
    await saveGithubConfig(CONFIG);
    await clearGithubConfig();
    expect(await loadGithubConfig()).toBeNull();
    expect(isGithubConfigured()).toBe(false);
  });

  it('库里存的是脏数据时不报错', async () => {
    await DB('settings').insert({
      configName: 'github_config',
      configValue: '不是 JSON',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await initGithubConfigStore(DB);
    expect(await loadGithubConfig()).toBeNull();
  });
});
