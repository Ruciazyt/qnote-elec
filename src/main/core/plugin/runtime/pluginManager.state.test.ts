// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import knexFactory, { type Knex } from "knex";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "2.0.0-test",
    isPackaged: false,
  },
}));

import { PluginManager } from "./pluginManager";
import { setPluginGrant } from "../permissions/pluginGrants";

const HOST_VERSION = "2.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDK_PATH = path.resolve(
  HERE,
  "../../../../../resources/plugin-sdk/qnote-plugin-sdk.js"
);

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

function manifestOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "demo.my-plugin",
    name: "小工具",
    version: "1.0.0",
    publisher: "demo",
    engines: { qnote: `^${HOST_VERSION}` },
    runtime: { command: "node index.js" },
    capabilities: { process: { spawn: true } },
    ...extra,
  };
}

describe("插件管理器的授权与依赖", () => {
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-"));
  });

  afterEach(async () => {
    await manager.dispose();
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeManifest(manifest: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
  }

  async function importPlugin(
    manifest: Record<string, unknown>
  ): Promise<string> {
    writeManifest(manifest);
    const result = await manager.importPlugin(dir, "local");
    if (!result.ok) throw new Error(`导入失败：${result.error}`);
    return result.plugin!.id;
  }

  it("导入时把清单声明的权限同步进 plugin_grant", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { qnote: { notes: "read" } } })
    );

    const rows = await DB("plugin_grant").where("plugin_id", id).select("*");
    expect(rows.map((row) => row.capability)).toEqual(["qnote.notes.read"]);
    expect(Number(rows[0].granted)).toBe(1);
  });

  it("刷新清单时把不再声明的授权清掉", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { network: ["127.0.0.1:*"] } })
    );
    expect(
      (await DB("plugin_grant").where("plugin_id", id).select("*")).length
    ).toBe(1);

    writeManifest(manifestOf({ capabilities: { process: { spawn: true } } }));
    await manager.refreshPlugins();

    const rows = await DB("plugin_grant").where("plugin_id", id).select("*");
    expect(rows.map((row) => row.capability)).toEqual(["process.spawn"]);
  });

  it("改写清单去掉 capabilities 后，授权跟着清掉", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { qnote: { notes: "read" } } })
    );
    expect(
      (await DB("plugin_grant").where("plugin_id", id).select("*")).length
    ).toBe(1);

    await manager.writeManifest(dir, { capabilities: {} });

    const rows = await DB("plugin_grant").where("plugin_id", id).select("*");
    expect(rows.length).toBe(0);
  });

  it("列出授权项，没声明的权限不出现", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { qnote: { notes: "write" } } })
    );

    const grants = await manager.listGrants(id);
    expect(grants.map((grant) => grant.capability).sort()).toEqual([
      "qnote.notes.read",
      "qnote.notes.write",
    ]);
  });

  it("设置授权项：撤销后能恢复", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { qnote: { notes: "read" } } })
    );

    expect(
      (await manager.setGrant(id, "qnote.notes.read", false)).ok
    ).toBe(true);
    let grants = await manager.listGrants(id);
    expect(grants[0].granted).toBe(false);

    expect((await manager.setGrant(id, "qnote.notes.read", true)).ok).toBe(true);
    grants = await manager.listGrants(id);
    expect(grants[0].granted).toBe(true);
  });

  it("清单没声明的权限不允许设置授权", async () => {
    const id = await importPlugin(
      manifestOf({ capabilities: { qnote: { notes: "read" } } })
    );

    const res = await manager.setGrant(id, "qnote.todos.read", true);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("没有声明");
  });

  it("依赖缺失时拒绝激活，错误里指明缺哪个插件", async () => {
    const id = await importPlugin(
      manifestOf({ extensionDependencies: ["other.needed@^1.0.0"] })
    );

    const started = await manager.startPlugin(id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("other.needed");
    expect(started.error).toContain("插件市场");
  });

  it("依赖版本不满足时拒绝激活", async () => {
    const id = await importPlugin(
      manifestOf({ extensionDependencies: ["other.needed@^2.0.0"] })
    );

    await DB("plugin").insert({
      id: "other.needed",
      name: "依赖插件",
      version: "1.0.0",
      publisher: "other",
      path: "C:/somewhere/other",
      status: "ready",
      origin: "local",
      enabled: 1,
      confirmed_manifest_hash: "",
      sort_order: 0,
    });

    const started = await manager.startPlugin(id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("other.needed");
    expect(started.error).toContain("^2.0.0");
    expect(started.error).toContain("1.0.0");
  });

  it("依赖齐了且版本对得上时不拦着启动", async () => {
    const id = await importPlugin(
      manifestOf({ extensionDependencies: ["other.needed@^1.0.0"] })
    );

    await DB("plugin").insert({
      id: "other.needed",
      name: "依赖插件",
      version: "1.2.0",
      publisher: "other",
      path: "C:/somewhere/other",
      status: "ready",
      origin: "local",
      enabled: 1,
      confirmed_manifest_hash: "",
      sort_order: 0,
    });

    const started = await manager.startPlugin(id);
    expect(started.error ?? "").not.toContain("other.needed");
  });

  it("撤销「启动子进程」后拒绝启动", async () => {
    const id = await importPlugin(manifestOf());
    await setPluginGrant(DB, id, "process.spawn", false);

    const started = await manager.startPlugin(id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("已被撤销");
  });
});

describe("插件运行状态机", () => {
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-state-"));
  });

  afterEach(async () => {
    await manager.dispose();
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function waitForStatus(
    pluginId: string,
    expected: string,
    timeoutMs = 15000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      const state = manager.getRuntimeState(pluginId);
      last = state?.status ?? "";
      if (last === expected) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return last;
  }

  it("进程起来是 activating，握手完成后才是 active，停完回到 inactive", async () => {
    const scriptPath = path.join(dir, "plugin.mjs");
    fs.writeFileSync(
      scriptPath,
      `import { createPlugin } from "${pathToFileUrl(SDK_PATH)}";

createPlugin({
  async activate(ctx) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    ctx.commands.register("demo.ping", async () => "pong");
  },
  async deactivate() {},
});
`,
      "utf-8"
    );

    const manifest = manifestOf({
      runtime: { command: `node "${scriptPath}"` },
    });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );

    const imported = await manager.importPlugin(dir, "local");
    expect(imported.ok).toBe(true);
    const id = imported.plugin!.id;

    const started = await manager.startPlugin(id);
    expect(started.ok).toBe(true);

    expect(manager.getRuntimeState(id)?.status).toBe("activating");

    expect(await waitForStatus(id, "active")).toBe("active");

    const result = await manager.executeCommand("demo.ping");
    expect(result).toBe("pong");

    await manager.stopPlugin(id);
    expect(await waitForStatus(id, "inactive")).toBe("inactive");
  });

  it("停插件时先让插件自己收尾，再结束进程", async () => {
    const markerPath = path.join(dir, "deactivated.txt");
    const scriptPath = path.join(dir, "plugin.mjs");
    fs.writeFileSync(
      scriptPath,
      `import { writeFileSync } from "node:fs";
import { createPlugin } from "${pathToFileUrl(SDK_PATH)}";

createPlugin({
  async activate(ctx) {
    ctx.commands.register("demo.ping", async () => "pong");
  },
  async deactivate() {
    writeFileSync(${JSON.stringify(markerPath)}, "bye");
  },
});
`,
      "utf-8"
    );

    const manifest = manifestOf({
      runtime: { command: `node "${scriptPath}"` },
    });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );

    const imported = await manager.importPlugin(dir, "local");
    expect(imported.ok).toBe(true);
    const id = imported.plugin!.id;

    await manager.startPlugin(id);
    expect(await waitForStatus(id, "active")).toBe("active");

    await manager.stopPlugin(id);
    expect(await waitForStatus(id, "inactive")).toBe("inactive");
    expect(fs.existsSync(markerPath)).toBe(true);
  });
});

function pathToFileUrl(filePath: string): string {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}
