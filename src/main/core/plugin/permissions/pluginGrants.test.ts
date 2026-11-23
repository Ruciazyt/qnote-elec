// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import knexFactory, { type Knex } from "knex";

import {
  isGrantActive,
  listPluginGrants,
  setPluginGrant,
  syncPluginGrants,
} from "./pluginGrants";

const PLUGIN_ID = "demo.my-plugin";

async function createSchema(DB: Knex): Promise<void> {
  await DB.schema.createTable("plugin_grant", (table) => {
    table.text("plugin_id").notNullable();
    table.text("capability").notNullable();
    table.integer("granted").notNullable().defaultTo(0);
    table.timestamp("granted_at");
    table.primary(["plugin_id", "capability"]);
  });
}

describe("插件授权（plugin_grant）", () => {
  let DB: Knex;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await createSchema(DB);
  });

  afterEach(async () => {
    await DB.destroy();
  });

  async function grantRows(): Promise<any[]> {
    return await DB("plugin_grant").where("plugin_id", PLUGIN_ID).select("*");
  }

  it("清单声明的权限同步进 plugin_grant，默认已授权", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, {
      process: { spawn: true },
      qnote: { notes: "read" },
    });

    const rows = await grantRows();
    expect(rows.map((row) => row.capability).sort()).toEqual([
      "process.spawn",
      "qnote.notes.read",
    ]);
    for (const row of rows) {
      expect(Number(row.granted)).toBe(1);
      expect(row.granted_at).toBeTruthy();
    }
  });

  it("声明成 write 的能力拆成读与写两项", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, { qnote: { notes: "write" } });

    const rows = await grantRows();
    expect(rows.map((row) => row.capability).sort()).toEqual([
      "qnote.notes.read",
      "qnote.notes.write",
    ]);
  });

  it("清单里不再声明的授权被清掉，不留脏记录", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, { network: ["127.0.0.1:*"] });
    expect((await grantRows()).length).toBe(1);

    await syncPluginGrants(DB, PLUGIN_ID, { process: { spawn: true } });

    const rows = await grantRows();
    expect(rows.map((row) => row.capability)).toEqual(["process.spawn"]);
  });

  it("已经撤销的授权不会被重新同步成已授权", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, { qnote: { notes: "read" } });
    await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", false);

    await syncPluginGrants(DB, PLUGIN_ID, { qnote: { notes: "read" } });

    const row = await DB("plugin_grant")
      .where("plugin_id", PLUGIN_ID)
      .where("capability", "qnote.notes.read")
      .first();
    expect(Number(row.granted)).toBe(0);
  });

  it("撤销之后 isGrantActive 立刻返回否，恢复之后又回到是", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, { qnote: { notes: "read" } });

    expect(await isGrantActive(DB, PLUGIN_ID, "qnote.notes.read")).toBe(true);

    await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", false);
    expect(await isGrantActive(DB, PLUGIN_ID, "qnote.notes.read")).toBe(false);

    await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", true);
    expect(await isGrantActive(DB, PLUGIN_ID, "qnote.notes.read")).toBe(true);
  });

  it("没有记录的那一项按已授权处理（清单声明优先）", async () => {
    expect(await isGrantActive(DB, PLUGIN_ID, "qnote.todos.read")).toBe(true);
  });

  it("listPluginGrants 报出清单声明的每一项与当前状态", async () => {
    await syncPluginGrants(DB, PLUGIN_ID, {
      process: { spawn: true },
      qnote: { notes: "write" },
    });
    await setPluginGrant(DB, PLUGIN_ID, "qnote.notes.read", false);

    const grants = await listPluginGrants(DB, PLUGIN_ID, {
      process: { spawn: true },
      qnote: { notes: "write" },
    });

    const byKey = Object.fromEntries(
      grants.map((grant) => [grant.capability, grant.granted])
    );
    expect(byKey["process.spawn"]).toBe(true);
    expect(byKey["qnote.notes.read"]).toBe(false);
    expect(byKey["qnote.notes.write"]).toBe(true);
    expect(grants.every((grant) => grant.pluginId === PLUGIN_ID)).toBe(true);
  });
});
