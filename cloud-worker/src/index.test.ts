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

import { D1Client } from "../../src/database/cloud/d1Client";
import { D1SqlExecutor } from "../../src/database/cloud/d1Store";
import { SharedStoreOnExecutor } from "../../src/database/cloud/sharedStore";
import worker from "./index";


function makeBinding(db: Knex) {
  interface FakeStatement {
    sql: string;
    bound: unknown[];
    bind(...values: unknown[]): FakeStatement;
    all(): Promise<D1ResultLike>;
  }

  return {
    prepare(sql: string): FakeStatement {
      const statement: FakeStatement = {
        sql,
        bound: [],
        bind(...values: unknown[]) {
          statement.bound.push(...values);
          return statement;
        },
        async all() {
          const rows = await db.raw(sql, statement.bound as never[]);
          return toD1Result(rows);
        },
      };
      return statement;
    },

    async batch(statements: FakeStatement[]) {
      try {
        return await db.transaction(async (trx) => {
          const out: D1ResultLike[] = [];
          for (const statement of statements) {
            const rows = await trx.raw(statement.sql, statement.bound as never[]);
            out.push(toD1Result(rows));
          }
          return out;
        });
      } catch (error) {
        throw error;
      }
    },
  };
}

function toD1Result(rows: unknown): D1ResultLike {
  const list = Array.isArray(rows) ? rows : [];
  return {
    success: true,
    results: list.filter(
      (row) => row && typeof row === "object" && !Array.isArray(row)
    ),
    meta: { changes: list.length, duration: 0 },
  };
}

interface D1ResultLike {
  success: boolean;
  results: unknown[];
  meta: { changes: number; duration: number };
}

describe("公共目录 Worker 的端到端", () => {
  let server: http.Server;
  let db: Knex;
  let port: number;

  beforeAll(async () => {
    db = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });

    const binding = makeBinding(db);

    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");

      const response = await worker.fetch(
        new Request(`https://worker.test${req.url}`, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          body: req.method === "GET" ? undefined : body,
        }),
        { DB: binding as never }
      );

      const text = await response.text();
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      });
      res.end(text);
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

  const makeStore = () => {
    const client = new D1Client({
      endpoint: `http://127.0.0.1:${port}`,
    });
    return new SharedStoreOnExecutor("public", new D1SqlExecutor(client));
  };

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

    expect(await store.remove(published.id)).toBe(true);
    expect((await store.list()).total).toBe(0);
  });

  it("关键词转义在真 HTTP 上也成立", async () => {
    const store = makeStore();
    await store.init();
    await store.publish({ name: "番茄钟", manifest: "{}" });

    expect((await store.list({ keyword: "番茄" })).total).toBe(1);
    expect((await store.list({ keyword: "%" })).total).toBe(0);
  });

  it("请求不带 Authorization —— Worker 模式没有令牌", async () => {
    let seenAuth: string | undefined = "unset";
    const probe = http.createServer(async (req, res) => {
      seenAuth = req.headers["authorization"] as string | undefined;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, result: [{ success: true, results: [] }] }));
    });
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const probePort = (probe.address() as any).port;

    const client = new D1Client({ endpoint: `http://127.0.0.1:${probePort}` });
    await client.query("SELECT 1");

    expect(seenAuth).toBeUndefined();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  it("Worker 拒绝危险语句 —— 客户端拿到的��是明确的中文原因", async () => {
    const store = makeStore();
    await store.init();

    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "DROP TABLE published_app" }),
    });
    const payload = await response.json();

    expect(payload.success).toBe(false);
    expect(String(payload.errors?.[0]?.message ?? "")).toContain("语句被拒绝");
  });

  it("Worker 拒绝操作别的表", async () => {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM note" }),
    });
    const payload = await response.json();
    expect(payload.success).toBe(false);
  });

  it("batch 里一条失败 → 整批回滚，不留半截数据", async () => {
    const store = makeStore();
    await store.init();

    const client = new D1Client({ endpoint: `http://127.0.0.1:${port}` });
    await expect(
      client.batch([
        { sql: "INSERT INTO published_app (id, name) VALUES ('x1', 'X')" },
        { sql: "INSERT INTO 不存在的表 (id) VALUES ('y')" },
      ])
    ).rejects.toThrow();

    const list = await store.list();
    expect(list.apps.find((a) => a.id === "x1")).toBeUndefined();
  });
});
