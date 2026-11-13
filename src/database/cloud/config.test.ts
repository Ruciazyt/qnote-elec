// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import knexFactory, { type Knex } from "knex";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  DEFAULT_CLOUD_CONFIG,
  loadCloudConfig,
  parseCloudConfig,
  saveCloudConfig,
} from "./config";
import { resolveDefaultEndpoint } from "./defaults";

/**
 * 云端配置与后端切换的回归
 *
 * 配置的解析是这里最需要守的地方：配置是从**本地数据库**里读出来的一串
 * JSON，它可能因为升级、损坏、手改而变得不合法。
 *
 * 解析失败时的行为必须是「退回纯本地」，而不是抛异常 ——
 * 一份坏配置不该让整个应用起不来。
 *
 * ## 「没配过」与「配坏了」是两件事
 *
 * - 没配过（库里没有这条记录）→ 用**内置的公共目录地址**（零配置）
 * - 配坏了（JSON 非法、后端名不认识、D1 三项缺一不可）
 *   → 退回**纯本地**
 *
 * 第二种不能顺带连上公共目录：用户明明写过配置，说明他有明确意图；
 * 拿内置地址替他做决定是越权。测试里这两条要分开断言。
 */

/** 内置的公共目录地址 —— 正式版里非空 */
const BUILTIN_ENDPOINT = resolveDefaultEndpoint();

/** 「什么都没配」时实际生效的后端 */
const ZERO_CONFIG_BACKEND = BUILTIN_ENDPOINT ? "public" : "local";

describe("云端配置解析", () => {
  it("没配过时用内置的公共目录 —— 零配置", () => {
    const config = parseCloudConfig(null);
    expect(config.backend).toBe(ZERO_CONFIG_BACKEND);
    expect(config.d1).toBeNull();
    expect(config.endpoint).toBe(BUILTIN_ENDPOINT || null);
  });

  it("内置了公共目录地址时，装上就能用，不用填任何东西", () => {
    // 正式版内置了地址 → 默认就是公共目录
    expect(BUILTIN_ENDPOINT).not.toBe("");
    expect(BUILTIN_ENDPOINT).toMatch(/^https?:\/\//);
    expect(parseCloudConfig(null).backend).toBe("public");
  });

  it("空串等同于没配过", () => {
    expect(parseCloudConfig("").backend).toBe(ZERO_CONFIG_BACKEND);
  });

  it("不是合法 JSON → 退回纯本地，不抛异常", () => {
    const config = parseCloudConfig("{ 这不是 JSON");
    expect(config.backend).toBe("local");
    expect(config.d1).toBeNull();
  });

  it("不是对象 → 退回纯本地", () => {
    expect(parseCloudConfig('"一个字符串"').backend).toBe("local");
    expect(parseCloudConfig("123").backend).toBe("local");
    expect(parseCloudConfig("null").backend).toBe("local");
  });

  it("完整的 D1 配置能读出来", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "d1",
        d1: {
          accountId: "acct-1",
          databaseId: "db-2",
          apiToken: "tok-3",
        },
      })
    );
    expect(config.backend).toBe("d1");
    expect(config.d1).toEqual({
      accountId: "acct-1",
      databaseId: "db-2",
      apiToken: "tok-3",
    });
  });

  it("后端写着 d1 但配置不全 → 按 local 处理", () => {
    // 配了一半就切云端，注定连不上 —— 不如老实留在本地
    const config = parseCloudConfig(
      JSON.stringify({ backend: "d1", d1: { accountId: "acct-1" } })
    );
    expect(config.backend).toBe("local");
    expect(config.d1).toBeNull();
  });

  it("三个字段缺一不可", () => {
    const cases = [
      { accountId: "", databaseId: "db", apiToken: "tok" },
      { accountId: "acct", databaseId: "", apiToken: "tok" },
      { accountId: "acct", databaseId: "db", apiToken: "" },
    ];
    for (const d1 of cases) {
      const config = parseCloudConfig(JSON.stringify({ backend: "d1", d1 }));
      expect(config.backend).toBe("local");
    }
  });

  it("字段两端的空白会被去掉", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "d1",
        d1: {
          accountId: "  acct-1  ",
          databaseId: "  db-2  ",
          apiToken: "  tok-3  ",
        },
      })
    );
    expect(config.d1?.accountId).toBe("acct-1");
    expect(config.d1?.apiToken).toBe("tok-3");
  });

  it("认不出的后端值按 local 处理", () => {
    const config = parseCloudConfig(JSON.stringify({ backend: "mysql" }));
    expect(config.backend).toBe("local");
  });

  it("默认配置就是没配过时实际生效的那份", () => {
    expect(DEFAULT_CLOUD_CONFIG.backend).toBe(ZERO_CONFIG_BACKEND);
    expect(DEFAULT_CLOUD_CONFIG.endpoint).toBe(BUILTIN_ENDPOINT || null);
  });
});

describe("公共目录（Worker 代理）", () => {
  it("地址合法时认得出 public 后端", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "public",
        endpoint: "https://qnote-catalog.example.workers.dev",
      })
    );
    expect(config.backend).toBe("public");
    expect(config.endpoint).toBe("https://qnote-catalog.example.workers.dev");
  });

  it("地址末尾的斜杠会被去掉 —— 拼 URL 时用得上", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "public",
        endpoint: "https://qnote-catalog.example.workers.dev/",
      })
    );
    expect(config.endpoint).toBe("https://qnote-catalog.example.workers.dev");
  });

  it("后端写着 public 但地址为空 → 按 local 处理", () => {
    const config = parseCloudConfig(JSON.stringify({ backend: "public" }));
    expect(config.backend).toBe("local");
    expect(config.endpoint).toBeNull();
  });

  it("地址不是 http(s) → 不认（file: 之类不该被当成云端地址）", () => {
    const config = parseCloudConfig(
      JSON.stringify({ backend: "public", endpoint: "file:///etc/passwd" })
    );
    expect(config.backend).toBe("local");
  });

  it("public 后端不需要 D1 那三项", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "public",
        endpoint: "https://x.workers.dev",
        d1: null,
      })
    );
    expect(config.backend).toBe("public");
    expect(config.d1).toBeNull();
  });
});

describe("配置读写", () => {
  let DB: Knex;

  beforeEach(async () => {
    DB = knexFactory({
      client: "sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await DB.schema.createTable("settings", (table) => {
      table.increments("id").primary();
      table.string("configName").notNullable().unique();
      table.string("configValue").notNullable();
      table.timestamp("created_at").defaultTo(DB.fn.now());
      table.timestamp("updated_at").defaultTo(DB.fn.now());
    });
  });

  afterEach(async () => {
    await DB.destroy();
  });

  it("没写过配置时读到默认", async () => {
    const config = await loadCloudConfig(DB);
    expect(config.backend).toBe(ZERO_CONFIG_BACKEND);
    expect(config.d1).toBeNull();
  });

  it("保存之后能读回来", async () => {
    await saveCloudConfig(DB, {
      backend: "d1",
      d1: { accountId: "acct-1", databaseId: "db-2", apiToken: "tok-3" },
      lastCheck: null,
    });

    const config = await loadCloudConfig(DB);
    expect(config.backend).toBe("d1");
    expect(config.d1?.databaseId).toBe("db-2");
  });

  it("反复保存不会插出多行", async () => {
    for (let i = 0; i < 3; i++) {
      await saveCloudConfig(DB, {
        backend: "local",
        d1: null,
        lastCheck: null,
      });
    }
    const rows = await DB("settings").where("configName", "cloud_storage_config");
    expect(rows).toHaveLength(1);
  });

  it("后一次保存覆盖前一次", async () => {
    await saveCloudConfig(DB, {
      backend: "d1",
      d1: { accountId: "a", databaseId: "b", apiToken: "c" },
      lastCheck: null,
    });
    await saveCloudConfig(DB, {
      backend: "local",
      d1: null,
      lastCheck: null,
    });

    const config = await loadCloudConfig(DB);
    expect(config.backend).toBe("local");
    expect(config.d1).toBeNull();
  });

  it("Token 落在本地库里 —— 它是本机的配置，不进仓库", async () => {
    await saveCloudConfig(DB, {
      backend: "d1",
      d1: { accountId: "a", databaseId: "b", apiToken: "secret-token" },
      lastCheck: null,
    });
    const row = await DB("settings")
      .where("configName", "cloud_storage_config")
      .first();
    expect(String(row.configValue)).toContain("secret-token");
  });
});
