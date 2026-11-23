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
  LocalSharedStore,
  createLocalSharedStore,
  escapeKeyword,
  generateAppId,
  likePattern,
  rowToApp,
  type SharedStore,
} from "./sharedStore";

const SAMPLE = {
  name: "番茄钟",
  description: "一个网页版番茄钟",
  author: "someone",
  manifest: '{"name":"番茄钟","command":"python main.py"}',
  repoUrl: "https://github.com/example/pomodoro",
  tags: "工具,计时",
};

function makeDb(): Knex {
  return knexFactory({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
}

describe("本地共享存储", () => {
  let db: Knex;
  let store: SharedStore;

  beforeEach(async () => {
    db = makeDb();
    store = createLocalSharedStore(db);
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
    const result = await store.list({ keyword: "%" });
    expect(result.total).toBe(0);
  });
});

describe("关键词转义", () => {
  it("反斜杠、百分号、下划线都会被转义", () => {
    expect(escapeKeyword("50%")).toBe("50\\%");
    expect(escapeKeyword("a_b")).toBe("a\\_b");
    expect(escapeKeyword("a\\b")).toBe("a\\\\b");
  });

  it("模式串两端补上百分号", () => {
    expect(likePattern("番茄")).toBe("%番茄%");
  });
});

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

describe("本地实现", () => {
  it("后端标记是 local", () => {
    const db = makeDb();
    const store = new LocalSharedStore(db);
    expect(store.backend).toBe("local");
  });
});

describe("版本与依赖", () => {
  it("写入之后读回来一致", async () => {
    const db = makeDb();
    const store = createLocalSharedStore(db);
    await store.init();

    const published = await store.publish({
      ...SAMPLE,
      version: "1.2.3",
      dependencies: [{ id: "a.b" }, { id: "c.d", range: "^2.0.0" }],
    });

    expect(published.version).toBe("1.2.3");
    expect(published.dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);

    const fetched = await store.get(published.id);
    expect(fetched?.version).toBe("1.2.3");
    expect(fetched?.dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);

    const listed = await store.list();
    expect(listed.apps[0].version).toBe("1.2.3");
    expect(listed.apps[0].dependencies).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^2.0.0" },
    ]);

    await db.destroy();
  });

  it("没有版本与依赖 —— 按空值处理", async () => {
    const db = makeDb();
    const store = createLocalSharedStore(db);
    await store.init();

    const published = await store.publish(SAMPLE);
    expect(published.version).toBeUndefined();
    expect(published.dependencies).toEqual([]);

    await db.destroy();
  });

  it("老记录没有这两列 —— 读取不炸", async () => {
    const db = makeDb();
    await db.raw(`CREATE TABLE published_app (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      manifest TEXT NOT NULL DEFAULT '',
      repo_url TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      pulls INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      bundle TEXT NOT NULL DEFAULT ''
    )`);
    await db.raw(
      `INSERT INTO published_app
        (id, name, description, author, manifest, repo_url, tags, pulls, created_at, updated_at, bundle)
       VALUES ('app_old', '老条目', '', '', '{}', '', '', 0, 1, 1, '')`
    );

    const store = createLocalSharedStore(db);
    await store.init();

    const fetched = await store.get("app_old");
    expect(fetched?.name).toBe("老条目");
    expect(fetched?.version).toBeUndefined();
    expect(fetched?.dependencies).toEqual([]);

    const listed = await store.list();
    expect(listed.apps[0].dependencies).toEqual([]);

    await db.destroy();
  });

  it("行里没有版本与依赖 —— 按空值处理", () => {
    const app = rowToApp({ id: "app_1", name: "老条目" });
    expect(app.version).toBeUndefined();
    expect(app.dependencies).toEqual([]);
  });

  it("依赖列里的内容不是合法 JSON —— 不炸", () => {
    const app = rowToApp({
      id: "app_1",
      name: "坏条目",
      dependencies: "{不是 json",
    });
    expect(app.dependencies).toEqual([]);
  });
});
