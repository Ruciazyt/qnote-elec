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
    getVersion: () => "2.1.0-test",
    isPackaged: false,
  },
}));

import { migrateLegacyProjects, slugifyPluginSegment } from "./legacyMigration";
import { parsePluginManifest } from "../../../../shared/plugin/manifest/pluginManifest";

const HOST_VERSION = "2.1.0";

async function createSchema(DB: Knex, withLegacy: boolean): Promise<void> {
  if (withLegacy) {
    await DB.schema.createTable("app_project", (table) => {
      table.increments("id").primary();
      table.text("name");
      table.text("path").notNullable();
      table.text("command");
      table.text("description");
      table.string("origin").notNullable().defaultTo("local");
    });
  }
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
    table.text("confirmed_manifest_hash").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").defaultTo(DB.fn.now());
    table.timestamp("updated_at").defaultTo(DB.fn.now());
  });
}

describe("旧应用迁移成插件", () => {
  let DB: Knex;
  let dir: string;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await createSchema(DB, true);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-legacy-"));
  });

  afterEach(async () => {
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeLegacy(name: string, extra: Record<string, unknown> = {}): string {
    const target = path.join(dir, name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, "qnote.json"),
      JSON.stringify(
        { name: "老应用", command: "node server.mjs", preview: 7788, ...extra },
        null,
        2
      ),
      "utf-8"
    );
    return target;
  }

  it("迁移后目录里有合法的 plugin.json，原 qnote.json 还在", async () => {
    const target = writeLegacy("my-app");
    const legacyBefore = fs.readFileSync(path.join(target, "qnote.json"), "utf-8");
    await DB("app_project").insert({ path: target, name: "老应用", origin: "local" });

    const result = await migrateLegacyProjects(DB, HOST_VERSION);

    expect(result.migrated).toBe(1);
    expect(result.failed).toHaveLength(0);

    const manifestPath = path.join(target, "plugin.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const parsed = parsePluginManifest(fs.readFileSync(manifestPath, "utf-8"));
    expect(parsed.manifest).not.toBeNull();
    expect(parsed.manifest?.id).toBe("local.my-app");
    expect(parsed.manifest?.engines.qnote).toBe("^2.1.0");

    expect(fs.existsSync(path.join(target, "qnote.json"))).toBe(true);
    expect(fs.readFileSync(path.join(target, "qnote.json"), "utf-8")).toBe(legacyBefore);
  });

  it("插件表里多一行，路径与 id 对得上", async () => {
    const target = writeLegacy("other-app");
    await DB("app_project").insert({ path: target, name: "老应用", origin: "local" });

    await migrateLegacyProjects(DB, HOST_VERSION);

    const rows = await DB("plugin").select("*");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("local.other-app");
    expect(rows[0].path).toBe(target);
    expect(rows[0].origin).toBe("local");
  });

  it("跑第二遍不重复迁（幂等）", async () => {
    const target = writeLegacy("idem-app");
    await DB("app_project").insert({ path: target, name: "老应用", origin: "local" });

    const first = await migrateLegacyProjects(DB, HOST_VERSION);
    const second = await migrateLegacyProjects(DB, HOST_VERSION);

    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await DB("plugin").select("*")) .toHaveLength(1);
  });

  it("没有旧应用表时直接返回空结果", async () => {
    await DB.schema.dropTable("app_project");
    const result = await migrateLegacyProjects(DB, HOST_VERSION);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it("目录名里的非法字符换成连字符，首尾分隔符去掉", () => {
    expect(slugifyPluginSegment("我的 应用")).toBe("我的-应用");
    expect(slugifyPluginSegment("--a.b--")).toBe("a.b");
    expect(slugifyPluginSegment("///")).toBe("plugin");
  });

  it("大写与连续点都要收拾干净，保证 id 合法", () => {
    expect(slugifyPluginSegment("MyApp")).toBe("myapp");
    expect(slugifyPluginSegment("a..b")).toBe("a.b");
    expect(slugifyPluginSegment("A")).toBe("a");
    expect(slugifyPluginSegment("..")).toBe("plugin");
  });
});
