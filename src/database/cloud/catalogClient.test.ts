// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { CatalogClient, CatalogError, parseCatalogPayload } from "./catalogClient";
import type { CatalogConfig } from "../../shared/cloud/cloudTypes";

const CONFIG: CatalogConfig = {
  baseUrl: "https://us-west-2.data.tidbcloud.com",
  appId: "app-123",
  publicKey: "public-key",
  privateKey: "private-key",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function okBody(rows: Array<Record<string, unknown>> = []) {
  return {
    type: "sql_endpoint",
    data: {
      columns: [{ col: "id", data_type: "VARCHAR", nullable: false }],
      rows,
      result: {
        code: 200,
        message: "Query OK",
        row_count: rows.length,
        row_affect: 0,
        limit: 500,
      },
    },
  };
}

describe("公共目录客户端", () => {
  it("请求地址按 App ID 与端点路径拼出来", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({ method: "GET", path: "/apps_list" });

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toBe(
      "https://us-west-2.data.tidbcloud.com/api/v1beta/app/app-123/endpoint/apps_list"
    );
  });

  it("查询参数进 query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({
      method: "GET",
      path: "/apps_list",
      query: { keyword: "番茄", limit: 20, offset: 0 },
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("keyword")).toBe("番茄");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("undefined 的参数不进 query string", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({
      method: "GET",
      path: "/apps_list",
      query: { keyword: undefined },
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.has("keyword")).toBe(false);
  });

  it("用 Public Key 与 Private Key 做 Basic 认证", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({ method: "GET", path: "/apps_count" });

    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    const expected = Buffer.from("public-key:private-key", "utf8").toString(
      "base64"
    );
    expect(headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("POST 的参数走 JSON body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({
      method: "POST",
      path: "/apps_publish",
      body: { id: "app_1", name: "番茄钟" },
    });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "app_1",
      name: "番茄钟",
    });
  });

  it("GET 不带 body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody()));
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.request({ method: "GET", path: "/apps_count" });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("返回的行按 key:value 解析出来", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(okBody([{ id: "app_1", name: "番茄钟", pulls: 3 }]))
    );
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    const result = await client.request({ method: "GET", path: "/apps_list" });

    expect(result.rows).toEqual([{ id: "app_1", name: "番茄钟", pulls: 3 }]);
    expect(result.code).toBe(200);
    expect(result.rowCount).toBe(1);
  });

  it("401 抛 CatalogError，带上状态码", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          type: "sql_endpoint",
          data: {
            columns: [],
            rows: [],
            result: { code: 401, message: "auth failed" },
          },
        },
        401
      )
    );
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await expect(
      client.request({ method: "GET", path: "/apps_count" })
    ).rejects.toThrow(CatalogError);
    await expect(
      client.request({ method: "GET", path: "/apps_count" })
    ).rejects.toMatchObject({ status: 401, message: "auth failed" });
  });

  it("HTTP 200 但 SQL 失败也算失败 —— 表不存在", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        type: "sql_endpoint",
        data: {
          columns: [],
          rows: [],
          result: { code: 1146, message: "table not found" },
        },
      })
    );
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await expect(
      client.request({ method: "GET", path: "/apps_count" })
    ).rejects.toMatchObject({ code: 1146, message: "table not found" });
  });

  it("响应不是 JSON 时给出可读原因", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    })) as unknown as typeof fetch;
    const client = new CatalogClient(CONFIG, fetchImpl);

    await expect(
      client.request({ method: "GET", path: "/apps_count" })
    ).rejects.toThrow(/不是合法 JSON/);
  });

  it("连不上时给出可读原因", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const client = new CatalogClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await expect(
      client.request({ method: "GET", path: "/apps_count" })
    ).rejects.toThrow(/连不上公共目录/);
  });
});

describe("响应解析", () => {
  it("没有 data 字段时给空结果，不抛异常", () => {
    const parsed = parseCatalogPayload({});
    expect(parsed.rows).toEqual([]);
    expect(parsed.columns).toEqual([]);
    expect(parsed.code).toBe(0);
  });

  it("不是对象的行会被丢掉", () => {
    const parsed = parseCatalogPayload({
      data: { rows: [{ id: "a" }, "字符串", null, [1, 2]] },
    });
    expect(parsed.rows).toEqual([{ id: "a" }]);
  });
});
