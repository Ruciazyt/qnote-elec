// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { D1Client, D1Error } from "./d1Client";


function makeFetch(
  handler: (url: string, init: RequestInit, callIndex: number) => {
    status?: number;
    body: unknown;
  }
) {
  const calls: Array<{ url: string; body: any }> = [];
  const impl = vi.fn(async (url: any, init: any) => {
    const index = calls.length;
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const { status = 200, body } = handler(String(url), init, index);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function okResponse(rows: unknown[] = []) {
  return {
    success: true,
    result: [{ success: true, results: rows, meta: { changes: rows.length } }],
  };
}

const BASE = {
  accountId: "acct-123",
  databaseId: "db-456",
  apiToken: "tok-secret",
};

describe("D1 客户端", () => {
  it("把账号与数据库 ID 拼进请求路径，并带上 Bearer 令牌", async () => {
    const { impl, calls } = makeFetch(() => ({ body: okResponse() }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await client.query("SELECT 1");

    expect(calls[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct-123/d1/database/db-456/query"
    );
  });

  it("单条查询读 result[0].results 作为行", async () => {
    const { impl } = makeFetch(() => ({
      body: okResponse([{ id: "app_1", name: "番茄钟" }]),
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    const rows = await client.query<{ id: string; name: string }>(
      "SELECT * FROM published_app"
    );

    expect(rows).toEqual([{ id: "app_1", name: "番茄钟" }]);
  });

  it("参数按顺序放进 body.params", async () => {
    const { impl, calls } = makeFetch(() => ({ body: okResponse() }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await client.query("SELECT * FROM published_app WHERE id = ?", ["app_1"]);

    expect(calls[0].body).toEqual({
      sql: "SELECT * FROM published_app WHERE id = ?",
      params: ["app_1"],
    });
  });

  it("多条语句走 batch —— D1 上只有它是原子的", async () => {
    const { impl, calls } = makeFetch(() => ({
      body: {
        success: true,
        result: [
          { success: true, results: [], meta: {} },
          { success: true, results: [], meta: {} },
        ],
      },
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await client.batch([
      { sql: "CREATE TABLE IF NOT EXISTS a (x INT)" },
      { sql: "CREATE TABLE IF NOT EXISTS b (y INT)" },
    ]);

    expect(Array.isArray(calls[0].body.batch)).toBe(true);
    expect(calls[0].body.batch).toHaveLength(2);
    expect(calls[0].body.sql).toBeUndefined();
  });

  it("batch 里某条失败 → 整批算失败并抛出", async () => {
    const { impl } = makeFetch(() => ({
      body: {
        success: true,
        result: [
          { success: true, results: [], meta: {} },
          { success: false, results: [], meta: {}, error: "FOREIGN KEY constraint failed" },
        ],
      },
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await expect(
      client.batch([
        { sql: "UPDATE a SET x = 1" },
        { sql: "UPDATE b SET y = 1" },
      ])
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("空 batch 不发请求", async () => {
    const { impl, calls } = makeFetch(() => ({ body: okResponse() }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await client.batch([]);

    expect(calls).toHaveLength(0);
  });

  it("只读查询失败会重试", async () => {
    const { impl, calls } = makeFetch((_url, _init, index) =>
      index === 0
        ? { status: 500, body: { success: false, errors: [{ code: 7500, message: "临时不可用" }] } }
        : { body: okResponse([{ id: "x" }]) }
    );
    const client = new D1Client({ ...BASE, fetchImpl: impl, maxRetries: 2 });

    const rows = await client.query("SELECT * FROM published_app");

    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("写操作失败**不**重试 —— 重试一次就可能写两条", async () => {
    const { impl, calls } = makeFetch(() => ({
      status: 500,
      body: { success: false, errors: [{ code: 7500, message: "临时不可用" }] },
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl, maxRetries: 2 });

    await expect(
      client.query("INSERT INTO published_app (id) VALUES (?)", ["app_1"])
    ).rejects.toThrow(D1Error);

    expect(calls).toHaveLength(1);
  });

  it("鉴权错误不重试 —— 重试也没用", async () => {
    const { impl, calls } = makeFetch(() => ({
      status: 403,
      body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl, maxRetries: 2 });

    await expect(client.query("SELECT 1")).rejects.toThrow(/Authentication error/);
    expect(calls).toHaveLength(1);
  });

  it("HTTP 失败时把 Cloudflare 的错误码带出来", async () => {
    const { impl } = makeFetch(() => ({
      status: 404,
      body: { success: false, errors: [{ code: 7404, message: "Database not found" }] },
    }));
    const client = new D1Client({ ...BASE, fetchImpl: impl });

    await expect(client.query("SELECT 1")).rejects.toMatchObject({ code: 7404 });
  });

  it("网络层失败 → 报「无法连接 D1」", async () => {
    const impl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.cloudflare.com");
    });
    const client = new D1Client({
      ...BASE,
      fetchImpl: impl as unknown as typeof fetch,
      maxRetries: 0,
    });

    await expect(client.query("SELECT 1")).rejects.toThrow(/无法连接云端存储/);
  });

  it("响应不是 JSON → 报明确的错，而不是让 JSON.parse 的异常裸奔", async () => {
    const impl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    })) as unknown as typeof fetch;
    const client = new D1Client({ ...BASE, fetchImpl: impl, maxRetries: 0 });

    await expect(client.query("SELECT 1")).rejects.toThrow(/不是合法 JSON/);
  });

  it("超时 → 报超时，而不是干等", async () => {
    const impl = vi.fn(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        })
    ) as unknown as typeof fetch;
    const client = new D1Client({
      ...BASE,
      fetchImpl: impl,
      timeoutMs: 20,
      maxRetries: 0,
    });

    await expect(client.query("SELECT 1")).rejects.toThrow(/超时/);
  });
});
