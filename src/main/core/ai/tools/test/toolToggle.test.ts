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
  getDisabledToolNames,
  initToolToggleStore,
  isToolEnabled,
  setToolEnabled,
} from "../toolToggle";

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
});

afterEach(async () => {
  await DB.destroy();
});

describe("内置工具开关", () => {
  it("默认全部启用", async () => {
    await initToolToggleStore(DB);
    expect(isToolEnabled("get_todos")).toBe(true);
    expect(getDisabledToolNames()).toEqual([]);
  });

  it("关闭后立即生效并写进数据库", async () => {
    await initToolToggleStore(DB);
    await setToolEnabled("get_todos", false);
    expect(isToolEnabled("get_todos")).toBe(false);
    const row = await DB("settings")
      .where("configName", "disabled_ai_tools")
      .first();
    expect(JSON.parse(row.configValue)).toEqual(["get_todos"]);
  });

  it("重新初始化后仍保持关闭状态", async () => {
    await initToolToggleStore(DB);
    await setToolEnabled("web_search", false);
    await initToolToggleStore(DB);
    expect(isToolEnabled("web_search")).toBe(false);
    expect(isToolEnabled("get_todos")).toBe(true);
  });

  it("重新开启会从库里移除记录", async () => {
    await initToolToggleStore(DB);
    await setToolEnabled("web_search", false);
    await setToolEnabled("web_search", true);
    expect(isToolEnabled("web_search")).toBe(true);
    const row = await DB("settings")
      .where("configName", "disabled_ai_tools")
      .first();
    expect(JSON.parse(row.configValue)).toEqual([]);
  });

  it("库里存的是脏数据时不报错", async () => {
    await DB("settings").insert({
      configName: "disabled_ai_tools",
      configValue: "不是 JSON",
      created_at: new Date(),
      updated_at: new Date(),
    });
    await initToolToggleStore(DB);
    expect(isToolEnabled("get_todos")).toBe(true);
  });
});
