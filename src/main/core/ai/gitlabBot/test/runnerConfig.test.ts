// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import knexFactory, { type Knex } from "knex";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  defaultGitlabBotConfig,
  initGitlabBotConfigStore,
  loadGitlabBotConfig,
  saveGitlabBotConfig,
} from "../config/configStore";

let DB: Knex;

beforeEach(async () => {
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
  await initGitlabBotConfigStore(DB);
});

afterEach(async () => {
  await DB.destroy();
});

describe("网关的 Runner 配置", () => {
  it("默认开启 runner、标签是 qnote", () => {
    const config = defaultGitlabBotConfig();
    expect(config.runnerEnabled).toBe(true);
    expect(config.runnerTags).toEqual(["qnote"]);
    expect(config.runnerProject).toBe("");
  });

  it("保存后能读回来", async () => {
    await saveGitlabBotConfig({
      runnerEnabled: false,
      runnerProject: "team/app",
      runnerTags: ["qnote", "bot"],
    });
    const loaded = await loadGitlabBotConfig();
    expect(loaded.runnerEnabled).toBe(false);
    expect(loaded.runnerProject).toBe("team/app");
    expect(loaded.runnerTags).toEqual(["qnote", "bot"]);
  });

  it("老配置里没有 runner 字段时按默认值补齐", async () => {
    await DB("settings").insert({
      configName: "gitlab_bot_config",
      configValue: JSON.stringify({
        enabled: true,
        port: 7799,
        relayToken: "qnrelay_x",
      }),
      created_at: new Date(),
      updated_at: new Date(),
    });
    const loaded = await loadGitlabBotConfig();
    expect(loaded.runnerEnabled).toBe(true);
    expect(loaded.runnerProject).toBe("");
    expect(loaded.runnerTags).toEqual([]);
  });

  it("runnerEnabled 只认布尔值", async () => {
    await DB("settings").insert({
      configName: "gitlab_bot_config",
      configValue: JSON.stringify({
        enabled: true,
        port: 7799,
        runnerEnabled: "no",
        runnerProject: 42,
      }),
      created_at: new Date(),
      updated_at: new Date(),
    });
    const loaded = await loadGitlabBotConfig();
    expect(loaded.runnerEnabled).toBe(true);
    expect(loaded.runnerProject).toBe("");
  });
});
