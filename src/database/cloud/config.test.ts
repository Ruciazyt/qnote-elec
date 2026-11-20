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
  DEFAULT_CLOUD_CONFIG,
  loadCloudConfig,
  parseCloudConfig,
  saveCloudConfig,
} from "./config";
import {
  resolveCatalogDefaults,
  resolveDefaultCatalogConfig,
  sanitizeCatalogConfig,
} from "./defaults";

const BUILTIN = resolveDefaultCatalogConfig();
const ZERO_CONFIG_BACKEND = BUILTIN ? "catalog" : "local";

const FULL_CATALOG = {
  baseUrl: "https://us-west-2.data.tidbcloud.com",
  appId: "app-123",
  publicKey: "public-key",
  privateKey: "private-key",
};

describe("云端配置解析", () => {
  it("没配过时用内置的公共目录 —— 没内置就退回本地", () => {
    const config = parseCloudConfig(null);
    expect(config.backend).toBe(ZERO_CONFIG_BACKEND);
    expect(config.catalog).toEqual(BUILTIN);
  });

  it("空串等同于没配过", () => {
    expect(parseCloudConfig("").backend).toBe(ZERO_CONFIG_BACKEND);
  });

  it("不是合法 JSON → 退回纯本地，不抛异常", () => {
    const config = parseCloudConfig("{ 这不是 JSON");
    expect(config.backend).toBe("local");
    expect(config.catalog).toBeNull();
  });

  it("不是对象 → 退回纯本地", () => {
    expect(parseCloudConfig('"一个字符串"').backend).toBe("local");
    expect(parseCloudConfig("123").backend).toBe("local");
    expect(parseCloudConfig("null").backend).toBe("local");
  });

  it("完整的公共目录配置能读出来", () => {
    const config = parseCloudConfig(
      JSON.stringify({ backend: "catalog", catalog: FULL_CATALOG })
    );
    expect(config.backend).toBe("catalog");
    expect(config.catalog).toEqual(FULL_CATALOG);
  });

  it("后端写着 catalog 但配置不全 → 按 local 处理", () => {
    const config = parseCloudConfig(
      JSON.stringify({ backend: "catalog", catalog: { appId: "app-123" } })
    );
    expect(config.backend).toBe("local");
    expect(config.catalog).toBeNull();
  });

  it("四个字段缺一不可", () => {
    const cases = [
      { ...FULL_CATALOG, baseUrl: "" },
      { ...FULL_CATALOG, appId: "" },
      { ...FULL_CATALOG, publicKey: "" },
      { ...FULL_CATALOG, privateKey: "" },
    ];
    for (const catalog of cases) {
      const config = parseCloudConfig(JSON.stringify({ backend: "catalog", catalog }));
      expect(config.backend).toBe("local");
    }
  });

  it("字段两端的空白会被去掉", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "catalog",
        catalog: {
          baseUrl: "  https://us-west-2.data.tidbcloud.com  ",
          appId: "  app-123  ",
          publicKey: "  public-key  ",
          privateKey: "  private-key  ",
        },
      })
    );
    expect(config.catalog?.baseUrl).toBe("https://us-west-2.data.tidbcloud.com");
    expect(config.catalog?.appId).toBe("app-123");
  });

  it("站点地址会补上协议、去掉末尾斜杠", () => {
    const config = parseCloudConfig(
      JSON.stringify({
        backend: "catalog",
        catalog: { ...FULL_CATALOG, baseUrl: "us-west-2.data.tidbcloud.com/" },
      })
    );
    expect(config.catalog?.baseUrl).toBe("https://us-west-2.data.tidbcloud.com");
  });

  it("认不出的后端值按 local 处理", () => {
    const config = parseCloudConfig(JSON.stringify({ backend: "tidb" }));
    expect(config.backend).toBe("local");
  });

  it("默认配置就是没配过时实际生效的那份", () => {
    expect(DEFAULT_CLOUD_CONFIG.backend).toBe(ZERO_CONFIG_BACKEND);
    expect(DEFAULT_CLOUD_CONFIG.catalog).toEqual(BUILTIN);
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
    expect(config.catalog).toEqual(BUILTIN);
  });

  it("读配置时带上内置连接信息，界面可以直接预填", async () => {
    const config = await loadCloudConfig(DB);
    expect(config.catalogDefaults?.baseUrl).toBeTruthy();
    expect(config.catalogDefaults?.appId).toBeTruthy();
  });

  it("保存之后能读回来", async () => {
    await saveCloudConfig(DB, {
      backend: "catalog",
      catalog: FULL_CATALOG,
      lastCheck: null,
    });

    const config = await loadCloudConfig(DB);
    expect(config.backend).toBe("catalog");
    expect(config.catalog?.appId).toBe("app-123");
  });

  it("反复保存不会插出多行", async () => {
    for (let i = 0; i < 3; i++) {
      await saveCloudConfig(DB, {
        backend: "local",
        catalog: null,
        lastCheck: null,
      });
    }
    const rows = await DB("settings").where("configName", "cloud_storage_config");
    expect(rows).toHaveLength(1);
  });

  it("后一次保存覆盖前一次", async () => {
    await saveCloudConfig(DB, {
      backend: "catalog",
      catalog: FULL_CATALOG,
      lastCheck: null,
    });
    await saveCloudConfig(DB, {
      backend: "local",
      catalog: null,
      lastCheck: null,
    });

    const config = await loadCloudConfig(DB);
    expect(config.backend).toBe("local");
    expect(config.catalog).toBeNull();
  });

  it("私钥落在本地库里 —— 它是本机的配置，不进仓库", async () => {
    await saveCloudConfig(DB, {
      backend: "catalog",
      catalog: { ...FULL_CATALOG, privateKey: "secret-private-key" },
      lastCheck: null,
    });
    const row = await DB("settings")
      .where("configName", "cloud_storage_config")
      .first();
    expect(String(row.configValue)).toContain("secret-private-key");
  });
});

describe("内置的公共目录连接信息", () => {
  it("站点地址与 App ID 内置着，密钥不内置", () => {
    const defaults = resolveCatalogDefaults();
    expect(defaults.baseUrl).toBe("https://ap-northeast-1.data.tidbcloud.com");
    expect(defaults.appId).toBe("dataapp-bPMzJOGk");
    expect(defaults.baseUrl).not.toContain("/api/");
  });

  it("环境变量能改内置的站点地址与 App ID", () => {
    process.env.QNOTE_CATALOG_BASE_URL = "https://example.test/";
    process.env.QNOTE_CATALOG_APP_ID = "app-from-env";
    try {
      const defaults = resolveCatalogDefaults();
      expect(defaults.baseUrl).toBe("https://example.test");
      expect(defaults.appId).toBe("app-from-env");
    } finally {
      delete process.env.QNOTE_CATALOG_BASE_URL;
      delete process.env.QNOTE_CATALOG_APP_ID;
    }
  });

  it("四项不齐就不启用公共目录后端", () => {
    expect(
      sanitizeCatalogConfig({
        baseUrl: "https://example.test",
        appId: "app-1",
        publicKey: "pk",
      })
    ).toBeNull();
  });
});
