// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import knexFactory, { type Knex } from "knex";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "2.0.0-test",
    isPackaged: false,
  },
}));

import { PluginManager } from "./pluginManager";
import { setPluginGrant } from "../permissions/pluginGrants";
import { packProjectBundle } from "./bundle";

const HOST_VERSION = "2.0.0";

async function createSchema(DB: Knex): Promise<void> {
  await DB.schema.createTable("plugin", (table) => {
    table.increments("local_id").primary();
    table.text("id").notNullable().unique();
    table.text("name").notNullable();
    table.text("version").notNullable().defaultTo("0.0.1");
    table.text("publisher").notNullable().defaultTo("");
    table.text("description");
    table.text("path").notNullable().unique();
    table.string("status").notNullable().defaultTo("missing-manifest");
    table.text("manifest_text");
    table.text("command");
    table.text("preview");
    table.text("error");
    table.text("runtime_json");
    table.text("capabilities_json");
    table.text("contributes_json");
    table.string("origin").notNullable().defaultTo("local");
    table.integer("enabled").notNullable().defaultTo(1);
    table.string("confirmed_manifest_hash").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
  await DB.schema.createTable("plugin_setting", (table) => {
    table.text("plugin_id").notNullable();
    table.text("key").notNullable();
    table.text("value");
    table.primary(["plugin_id", "key"]);
  });
  await DB.schema.createTable("plugin_grant", (table) => {
    table.text("plugin_id").notNullable();
    table.text("capability").notNullable();
    table.integer("granted").notNullable().defaultTo(0);
    table.timestamp("granted_at");
    table.primary(["plugin_id", "capability"]);
  });
}

describe("市场插件升级", () => {
  let DB: Knex;
  let manager: PluginManager;
  let dir: string;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await createSchema(DB);
    manager = new PluginManager(DB);
    manager.setHostVersion(HOST_VERSION);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-upgrade-"));
  });

  afterEach(async () => {
    await manager.dispose();
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function payloadOf(version: string, extra: Record<string, unknown> = {}) {
    return {
      id: "demo.my-plugin",
      name: "小工具",
      version,
      publisher: "demo",
      engines: { qnote: `^${HOST_VERSION}` },
      runtime: { command: "node index.js" },
      capabilities: { qnote: { notes: "read" } },
      ...extra,
    };
  }

  async function importFromMarket(
    version: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const result = await manager.importFromMarket(dir, payloadOf(version, extra));
    if (!result.ok) throw new Error(`导入失败：${result.error}`);
    return result.plugin!.id;
  }

  it("升级后清单与版本号都换成新的", async () => {
    const id = await importFromMarket("1.0.0");

    const upgraded = await manager.upgradeFromMarket(
      id,
      payloadOf("1.1.0", { description: "新版本" })
    );

    expect(upgraded.ok).toBe(true);
    expect(upgraded.plugin?.version).toBe("1.1.0");
    expect(upgraded.plugin?.description).toBe("新版本");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, "plugin.json"), "utf-8")
    ) as Record<string, unknown>;
    expect(manifest.version).toBe("1.1.0");
  });

  it("升级后要重新走一次权限确认", async () => {
    const id = await importFromMarket("1.0.0");
    const first = await manager.checkStartConfirmation(id);
    expect(first).not.toBeNull();
    expect(await manager.confirmStart(id, first!.manifestHash)).toBe(true);
    expect(await manager.checkStartConfirmation(id)).toBeNull();

    await manager.upgradeFromMarket(id, payloadOf("1.1.0"));

    const again = await manager.checkStartConfirmation(id);
    expect(again).not.toBeNull();
    expect(again!.manifestHash).not.toBe(first!.manifestHash);
  });

  it("升级后按新清单同步授权，已撤销的保持撤销", async () => {
    const id = await importFromMarket("1.0.0");
    await setPluginGrant(DB, id, "qnote.notes.read", false);

    await manager.upgradeFromMarket(
      id,
      payloadOf("1.1.0", {
        capabilities: { qnote: { notes: "read" }, process: { spawn: true } },
      })
    );

    const rows = await DB("plugin_grant").where("plugin_id", id).select("*");
    const byCapability = new Map(
      rows.map((row) => [String(row.capability), Number(row.granted)])
    );
    expect(byCapability.get("qnote.notes.read")).toBe(0);
    expect(byCapability.get("process.spawn")).toBe(1);
  });

  it("资源包跟着覆盖上去", async () => {
    const id = await importFromMarket("1.0.0");
    fs.writeFileSync(path.join(dir, "old.txt"), "旧内容", "utf-8");
    const bundle = packProjectBundle(dir).bundle;

    const upgraded = await manager.upgradeFromMarket(id, payloadOf("1.1.0", { bundle }));

    expect(upgraded.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "old.txt"), "utf-8")).toBe("旧内容");
  });

  it("本机装的不是市场插件时拒绝升级", async () => {
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(payloadOf("1.0.0"), null, 2),
      "utf-8"
    );
    const imported = await manager.importPlugin(dir, "local");
    expect(imported.ok).toBe(true);

    const upgraded = await manager.upgradeFromMarket(
      imported.plugin!.id,
      payloadOf("1.1.0")
    );
    expect(upgraded.ok).toBe(false);
    expect(upgraded.error).toContain("市场");
  });

  it("发布记录的 id 对不上时拒绝升级", async () => {
    const id = await importFromMarket("1.0.0");

    const upgraded = await manager.upgradeFromMarket(
      id,
      payloadOf("1.1.0", { id: "other.plugin" })
    );
    expect(upgraded.ok).toBe(false);
    expect(upgraded.error).toContain("不是同一个插件");
  });
});
