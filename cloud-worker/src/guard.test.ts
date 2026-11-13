import { describe, it, expect } from "vitest";
import { checkStatement, normalizeParams, MAX_SQL_LENGTH } from "./guard";

/**
 * 公共目录 Worker 的 SQL 白名单
 *
 * 这个 Worker 的地址是**公开的**（内置在客户端里），谁都能往里 POST。
 * 所以「哪些语句能过」这件事必须有测试守着 ——
 * 白名单一松，数据库的全权就暴露在公网上了。
 *
 * 这里的每一条都对应一种真实的用法；改白名单时，
 * 先确认客户端（src/database/cloud/sharedStore.ts）还会发那种语句。
 */

describe("SQL 白名单", () => {
  it("放行客户端实际会发的那些语句", () => {
    const statements = [
      // 建表与建索引 —— init() 发的
      "CREATE TABLE IF NOT EXISTS published_app (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS published_app_updated_at_idx ON published_app(updated_at DESC)",
      // 查询
      "SELECT * FROM published_app WHERE id = ? LIMIT 1",
      "SELECT COUNT(*) AS n FROM published_app WHERE name LIKE ? ESCAPE '\\'",
      "SELECT * FROM published_app ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      // 写入
      "INSERT INTO published_app (id, name, description) VALUES (?, ?, ?)",
      "INSERT INTO published_app (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      "UPDATE published_app SET pulls = pulls + 1 WHERE id = ?",
      "DELETE FROM published_app WHERE id = ?",
    ];

    for (const sql of statements) {
      const result = checkStatement(sql);
      expect(result.ok, `应该放行：${sql}`).toBe(true);
    }
  });

  it("拒绝其它表", () => {
    const result = checkStatement("SELECT * FROM note");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("published_app");
  });

  it("拒绝删表与改表结构", () => {
    for (const sql of [
      "DROP TABLE published_app",
      "ALTER TABLE published_app ADD COLUMN x TEXT",
      "DROP TABLE IF EXISTS published_app",
    ]) {
      const result = checkStatement(sql);
      expect(result.ok, `应该拒绝：${sql}`).toBe(false);
    }
  });

  it("拒绝 PRAGMA —— 它能读出整个库的内部信息", () => {
    const result = checkStatement("PRAGMA table_info(published_app)");
    expect(result.ok).toBe(false);
  });

  it("拒绝一次发多条语句 —— 最直接的注入面", () => {
    const result = checkStatement(
      "SELECT * FROM published_app; DROP TABLE published_app"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("多条语句");
  });

  it("拒绝注释里藏着的分号", () => {
    const result = checkStatement(
      "SELECT * FROM published_app /* ; DROP TABLE published_app */"
    );
    expect(result.ok).toBe(false);
  });

  it("拒绝视图与触发器", () => {
    expect(checkStatement("CREATE VIEW v AS SELECT * FROM published_app").ok).toBe(false);
    expect(checkStatement("CREATE TRIGGER t AFTER INSERT ON published_app BEGIN SELECT 1; END").ok).toBe(false);
  });

  it("拒绝空语句与非字符串", () => {
    expect(checkStatement("").ok).toBe(false);
    expect(checkStatement("   ").ok).toBe(false);
    expect(checkStatement(undefined).ok).toBe(false);
    expect(checkStatement(null).ok).toBe(false);
    expect(checkStatement(123).ok).toBe(false);
  });

  it("拒绝过长的语句", () => {
    const result = checkStatement(
      `SELECT * FROM published_app WHERE name = '${"x".repeat(MAX_SQL_LENGTH)}'`
    );
    expect(result.ok).toBe(false);
  });

  it("大小写混写也认得出来 —— 白名单不能被大小写绕过", () => {
    const result = checkStatement("drop table published_app");
    expect(result.ok).toBe(false);
    const ok = checkStatement("select * from published_app");
    expect(ok.ok).toBe(true);
  });

  it("以别的表名开头的 SELECT 会被拒", () => {
    // FROM 后面必须紧跟 published_app —— 不能先查别的表再 JOIN 过来
    const result = checkStatement("SELECT * FROM other_table JOIN published_app");
    expect(result.ok).toBe(false);
  });
});

describe("参数规整", () => {
  it("undefined 转成 null —— D1 不接受 undefined", () => {
    expect(normalizeParams([undefined])).toEqual([null]);
  });

  it("布尔值转成 0/1 —— SQLite 没有布尔类型", () => {
    expect(normalizeParams([true, false])).toEqual([1, 0]);
  });

  it("数字与字符串原样保留", () => {
    expect(normalizeParams([1, "a", null])).toEqual([1, "a", null]);
  });

  it("不是数组就当空的", () => {
    expect(normalizeParams(undefined)).toEqual([]);
    expect(normalizeParams("x")).toEqual([]);
  });
});
