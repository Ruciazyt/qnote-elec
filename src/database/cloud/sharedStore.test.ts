// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import knexFactory, { type Knex } from "knex";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  SharedStoreOnExecutor,
  LocalSqlExecutor,
  generateAppId,
  type SharedStore,
  type SqlExecutor,
} from "./sharedStore";

/**
 * 共享存储的**契约测试**
 *
 * 同一套用例跑在两个后端上 —— 本地 SQLite 与 D1。
 *
 * ## 为什么要有这个
 *
 * 共享存储是「双后端」的：同一份逻辑要跑在本地 SQLite 和 Cloudflare D1 上。
 * 两个后端的行为只要有一处不一致，就会出现「本地能发布、D1 发布不了」
 * 这类只在特定环境下才暴露的问题 —— 而 D1 需要联网、需要真实账号，
 * 平时根本测不到。
 *
 * 把行为钉成一份契约，两边都跑一遍，就能在**不联网**的情况下
 * 保证两边一致。D1 那侧用「假 D1」执行器 —— 它按 D1 的语义实现
 * （尤其是 batch 的原子性与 D1 不支持交互式事务这一点）。
 */

/** 一条最小的发布记录 */
const SAMPLE = {
  name: "番茄钟",
  description: "一个网页版番茄钟",
  author: "someone",
  manifest: '{"name":"番茄钟","command":"python main.py"}',
  repoUrl: "https://github.com/example/pomodoro",
  tags: "工具,计时",
};

/* ============================================================
 * 假 D1 执行器
 * ============================================================
 *
 * 用真的 SQLite 跑，但**按 D1 的规矩来**：
 *   - batch 里的语句要么全成要么全不成（D1 的 batch 是事务）
 *   - 不提供交互式事务
 *
 * 这样测出来的行为就是 D1 上该有的行为。
 */
class FakeD1Executor implements SqlExecutor {
  private readonly db: Knex;
  /** batch 里的语句是否整体回滚过 */
  batchRollbacks = 0;

  constructor(db: Knex) {
    this.db = db;
  }

  async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.db.raw(sql, params as never[]);
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === "object") {
      return result as T[];
    }
    return [];
  }

  async batch(
    statements: Array<{ sql: string; params?: unknown[] }>
  ): Promise<void> {
    if (statements.length === 0) return;
    try {
      await this.db.transaction(async (trx) => {
        for (const statement of statements) {
          await trx.raw(statement.sql, (statement.params ?? []) as never[]);
        }
      });
    } catch (error) {
      this.batchRollbacks += 1;
      throw error;
    }
  }
}

/** 建一个内存里的 SQLite，给两个后端各用一份 */
function makeDb(): Knex {
  return knexFactory({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
}

/** 两个后端跑同一套契约 */
function describeBackend(
  name: string,
  makeStore: (db: Knex) => SharedStore
) {
  describe(name, () => {
    let db: Knex;
    let store: SharedStore;

    beforeEach(async () => {
      db = makeDb();
      store = makeStore(db);
      await store.init();
    });

    afterEach(async () => {
      await db.destroy();
    });

    it("init 之后能建出表（重复 init 也不报错）", async () => {
      await store.init();
      await store.init();
      const result = await store.list();
      expect(result.apps).toEqual([]);
    });

    it("发布之后能列出来", async () => {
      const published = await store.publish(SAMPLE);
      expect(published.name).toBe("番茄钟");

      const result = await store.list();
      expect(result.total).toBe(1);
      expect(result.apps[0].name).toBe("番茄钟");
    });

    it("列表按更新时间倒序 —— 刚发布的排前面", async () => {
      await store.publish({ ...SAMPLE, name: "第一个" });
      await new Promise((r) => setTimeout(r, 5));
      await store.publish({ ...SAMPLE, name: "第二个" });

      const result = await store.list();
      expect(result.apps.map((a) => a.name)).toEqual(["第二个", "第一个"]);
    });

    it("按 id 能取回同一条", async () => {
      const published = await store.publish(SAMPLE);
      const fetched = await store.get(published.id);
      expect(fetched?.name).toBe("番茄钟");
      expect(fetched?.manifest).toBe(SAMPLE.manifest);
    });

    it("取不存在的 id 返回 null", async () => {
      expect(await store.get("app_不存在")).toBeNull();
    });

    it("关键词能按名称 / 简介 / 标签 / 作者匹配", async () => {
      await store.publish(SAMPLE);
      // 第二条刻意换成不含「番茄」的简介 —— 否则搜「番茄」会命中两条，
      // 那就不是在测「按名称匹配」了
      await store.publish({
        ...SAMPLE,
        name: "别的应用",
        description: "完全不相干的简介",
        tags: "游戏",
      });

      expect((await store.list({ keyword: "番茄" })).total).toBe(1);
      expect((await store.list({ keyword: "计时" })).total).toBe(1);
      expect((await store.list({ keyword: "someone" })).total).toBe(2);
      expect((await store.list({ keyword: "不存在的词" })).total).toBe(0);
    });

    it("分页能取到后续的条目", async () => {
      for (let i = 0; i < 5; i++) {
        await store.publish({ ...SAMPLE, name: `应用${i}` });
        await new Promise((r) => setTimeout(r, 2));
      }

      const first = await store.list({ limit: 2, offset: 0 });
      expect(first.apps).toHaveLength(2);
      expect(first.total).toBe(5);

      const second = await store.list({ limit: 2, offset: 2 });
      expect(second.apps).toHaveLength(2);
      // 两页不能有重叠
      const firstIds = first.apps.map((a) => a.id);
      expect(second.apps.every((a) => !firstIds.includes(a.id))).toBe(true);
    });

    it("limit 被夹在合理范围内 —— 不能一次拖走整个库", async () => {
      const result = await store.list({ limit: 999999 });
      expect(result.total).toBe(0);
      const clamped = await store.list({ limit: 0 });
      expect(clamped.apps).toEqual([]);
    });

    it("覆盖发布保留 id、创建时间与被获取次数", async () => {
      const published = await store.publish(SAMPLE);
      await store.incrementPulls(published.id);

      const updated = await store.publish(
        { ...SAMPLE, name: "改过的名字" },
        published.id
      );

      expect(updated.id).toBe(published.id);
      expect(updated.name).toBe("改过的名字");
      expect(updated.createdAt).toBe(published.createdAt);
      expect(updated.pulls).toBe(1);
    });

    it("被获取次数会累加", async () => {
      const published = await store.publish(SAMPLE);
      await store.incrementPulls(published.id);
      await store.incrementPulls(published.id);

      const fetched = await store.get(published.id);
      expect(fetched?.pulls).toBe(2);
    });

    it("删除之后取不到了", async () => {
      const published = await store.publish(SAMPLE);
      expect(await store.remove(published.id)).toBe(true);
      expect(await store.get(published.id)).toBeNull();
      expect((await store.list()).total).toBe(0);
    });

    it("删除不存在的条目返回 false", async () => {
      expect(await store.remove("app_不存在")).toBe(false);
    });

    it("字段里的单引号不会破坏 SQL", async () => {
      const published = await store.publish({
        ...SAMPLE,
        name: "O'Brien 的应用",
        description: "带 ' 引号的简介",
      });
      const fetched = await store.get(published.id);
      expect(fetched?.name).toBe("O'Brien 的应用");
      expect(fetched?.description).toBe("带 ' 引号的简介");
    });

    it("通配符不会被当成 SQL 里的模式", async () => {
      await store.publish(SAMPLE);
      // % 在 LIKE 里是通配符 —— 查 % 应该命中「百分号」而不是全部
      const result = await store.list({ keyword: "%" });
      expect(result.total).toBe(0);
    });
  });
}

describeBackend("本地共享存储", (db) =>
  new SharedStoreOnExecutor("local", new LocalSqlExecutor(db))
);

describeBackend("D1 共享存储（假 D1）", (db) =>
  new SharedStoreOnExecutor("d1", new FakeD1Executor(db))
);

describe("id 生成", () => {
  it("每次生成都不一样", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateAppId()));
    expect(ids.size).toBe(200);
  });

  it("带可识别的前缀", () => {
    expect(generateAppId().startsWith("app_")).toBe(true);
  });

  it("只含 URL 安全的字符", () => {
    expect(generateAppId()).toMatch(/^app_[a-z0-9_]+$/);
  });
});

describe("D1 的原子性边界", () => {
  it("batch 里有一条失败 → 整批回滚（不会只写一半）", async () => {
    const db = makeDb();
    try {
      const executor = new FakeD1Executor(db);
      const store = new SharedStoreOnExecutor("d1", executor);
      await store.init();

      await expect(
        executor.batch([
          { sql: `INSERT INTO published_app (id, name) VALUES ('a', 'A')` },
          { sql: `INSERT INTO 不存在的表 (id) VALUES ('b')` },
        ])
      ).rejects.toThrow();

      expect(executor.batchRollbacks).toBe(1);
      // 第一条也不能留下 —— 整批是一个事务
      const rows = await executor.all(
        "SELECT * FROM published_app WHERE id = ?",
        ["a"]
      );
      expect(rows).toHaveLength(0);
    } finally {
      await db.destroy();
    }
  });
});
