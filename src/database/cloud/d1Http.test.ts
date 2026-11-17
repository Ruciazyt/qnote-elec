// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import knexFactory, { type Knex } from "knex";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { D1Client } from "./d1Client";
import { D1SqlExecutor } from "./d1Store";
import { SharedStoreOnExecutor } from "./sharedStore";


interface CapturedRequest {
  path: string;
  auth: string | undefined;
  body: any;
}

describe("D1 客户端的真实 HTTP 端到端", () => {
  let server: http.Server;
  let db: Knex;
  let port: number;
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    db = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("published_app", (table) => {
      table.string("id").primary();
      table.string("name").notNullable();
      table.string("description").notNullable().defaultTo("");
      table.string("author").notNullable().defaultTo("");
      table.string("manifest").notNullable().defaultTo("");
      table.string("repo_url").notNullable().defaultTo("");
      table.string("tags").notNullable().defaultTo("");
      table.integer("pulls").notNullable().defaultTo(0);
      table.integer("created_at").notNullable().defaultTo(0);
      table.integer("updated_at").notNullable().defaultTo(0);
    });

    server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      captured.push({
        path: req.url ?? "",
        auth: req.headers["authorization"] as string | undefined,
        body,
      });

      if (req.headers["authorization"] !== "Bearer tok-secret") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
          })
        );
        return;
      }

      const statements = body.batch
        ? body.batch
        : [{ sql: body.sql, params: body.params }];

      let result;
      try {
        result = await db.transaction(async (trx) => {
          const out = [];
          for (const statement of statements) {
            const rows = await trx.raw(statement.sql, statement.params ?? []);
            const list = Array.isArray(rows) ? rows : [];
            out.push({
              success: true,
              results: list.filter(
                (row) => row && typeof row === "object" && !Array.isArray(row)
              ),
              meta: { changes: list.length },
            });
          }
          return out;
        });
      } catch (error) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            result: statements.map(() => ({
              success: false,
              results: [],
              meta: {},
              error: error instanceof Error ? error.message : String(error),
            })),
          })
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    port = (server.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.destroy();
  });

  const makeClient = (token = "tok-secret") =>
    new D1Client({
      accountId: "acct",
      databaseId: "db",
      apiToken: token,
      fetchImpl: (url, init) =>
        fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`, init),
    });

  const makeStore = (token = "tok-secret") =>
    new SharedStoreOnExecutor("d1", new D1SqlExecutor(makeClient(token)));

  it("请求打到正确的路径，并带上 Bearer 令牌", async () => {
    captured.length = 0;
    await makeClient().query("SELECT 1");

    expect(captured[0].path).toBe(
      "/client/v4/accounts/acct/d1/database/db/query"
    );
    expect(captured[0].auth).toBe("Bearer tok-secret");
    expect(captured[0].body).toEqual({
      sql: "SELECT 1",
      params: [],
    });
  });

  it("完整流程跑通：建表 → 发布 → 列表 → 覆盖 → 删除", async () => {
    const store = makeStore();
    await store.init();

    const published = await store.publish({
      name: "番茄钟",
      description: "一个网页版番茄钟",
      author: "me",
      manifest: '{"name":"番茄钟","command":"python main.py"}',
      repoUrl: "https://github.com/x/y",
      tags: "工具,计时",
    });
    expect(published.name).toBe("番茄钟");
    expect(published.id.startsWith("app_")).toBe(true);

    const listed = await store.list();
    expect(listed.total).toBe(1);
    expect(listed.apps[0].name).toBe("番茄钟");

    await store.incrementPulls(published.id);
    const updated = await store.publish(
      { name: "改过的名字", manifest: "{}" },
      published.id
    );
    expect(updated.pulls).toBe(1);
    expect(updated.createdAt).toBe(published.createdAt);
    expect(updated.name).toBe("改过的名字");

    expect(await store.remove(published.id)).toBe(true);
    expect((await store.list()).total).toBe(0);
  });

  it("关键词转义在真 HTTP 上也成立 —— 搜 % 不该匹配全部", async () => {
    const store = makeStore();
    await store.init();
    await store.publish({ name: "番茄钟", manifest: "{}" });

    expect((await store.list({ keyword: "番茄" })).total).toBe(1);
    expect((await store.list({ keyword: "%" })).total).toBe(0);
    expect((await store.list({ keyword: "_" })).total).toBe(0);
  });

  it("batch 走的是 batch 字段 —— 不是一个拼起来的 sql", async () => {
    captured.length = 0;
    const store = makeStore();
    await store.init();
    await store.publish({ name: "x", manifest: "{}" });

    const batched = captured.find((c) => Array.isArray(c.body.batch));
    expect(batched).toBeDefined();
    expect(batched!.body.sql).toBeUndefined();
  });

  it("Token 不对 → 403 冒上来", async () => {
    await expect(makeClient("wrong-token").query("SELECT 1")).rejects.toThrow(
      /Authentication error/
    );
  });

  it("batch 里有一条失败 → 整批回滚，不会只写一半", async () => {
    const store = makeStore();
    await store.init();

    await expect(
      store.remove("app_不存在").then(() =>
        (store as any).executor.batch([
          { sql: "INSERT INTO published_app (id, name) VALUES ('a', 'A')" },
          { sql: "INSERT INTO 不存在的表 (id) VALUES ('b')" },
        ])
      )
    ).rejects.toThrow();

    const list = await store.list();
    expect(list.apps.find((a) => a.id === "a")).toBeUndefined();
  });
});
