// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import knexFactory, { type Knex } from "knex";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  clearGitlabConfig,
  initGitlabConfigStore,
  loadGitlabConfig,
  saveGitlabConfig,
  type StoredGitlabConfig,
} from "../configStore";
import { isGitlabConfigured } from "../../index";
import { configureGitlabToolkit, resetGitlabRuntime } from "../runtime";

const CONFIG: StoredGitlabConfig = {
  baseUrl: "https://gitlab.example.com",
  token: "secret-token",
  allowedProjects: ["group/app"],
  readOnly: false,
  expectedVersion: "19.2",
};

let DB: Knex;

beforeEach(async () => {
  resetGitlabRuntime();
  DB = knexFactory({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  await DB.schema.createTable("settings", (table) => {
    table.increments("id").primary();
    table.string("configName").notNullable().unique();
    table.string("configValue").notNullable();
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
});

afterEach(async () => {
  await DB.destroy();
});

describe("GitLab 配置存储", () => {
  it("没存过配置时返回空", async () => {
    await initGitlabConfigStore(DB);
    expect(await loadGitlabConfig()).toBeNull();
  });

  it("保存后能读回来", async () => {
    await initGitlabConfigStore(DB);
    await saveGitlabConfig(CONFIG);
    expect(await loadGitlabConfig()).toEqual(CONFIG);
  });

  it("初始化时把存好的配置注入运行时", async () => {
    await initGitlabConfigStore(DB);
    await saveGitlabConfig(CONFIG);
    await initGitlabConfigStore(DB);
    expect(isGitlabConfigured()).toBe(true);
  });

  it("配置注入后不会被工具层重置掉", async () => {
    await initGitlabConfigStore(DB);
    await saveGitlabConfig(CONFIG);
    configureGitlabToolkit({ logger: { info() {}, warn() {} } });
    expect(isGitlabConfigured()).toBe(true);
  });

  it("保存后立刻生效", async () => {
    await initGitlabConfigStore(DB);
    expect(isGitlabConfigured()).toBe(false);
    await saveGitlabConfig(CONFIG);
    expect(isGitlabConfigured()).toBe(true);
  });

  it("清除后配置回到未配置状态", async () => {
    await initGitlabConfigStore(DB);
    await saveGitlabConfig(CONFIG);
    await clearGitlabConfig();
    expect(await loadGitlabConfig()).toBeNull();
    expect(isGitlabConfigured()).toBe(false);
  });

  it("库里存的是脏数据时不报错", async () => {
    await DB("settings").insert({
      configName: "gitlab_config",
      configValue: "不是 JSON",
      created_at: new Date(),
      updated_at: new Date(),
    });
    await initGitlabConfigStore(DB);
    expect(await loadGitlabConfig()).toBeNull();
  });
});
