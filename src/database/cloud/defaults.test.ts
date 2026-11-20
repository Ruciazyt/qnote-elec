// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readCatalogCredentialFile,
  resolveCatalogDefaults,
  sanitizeCatalogConfig,
} from "./defaults";

const ENV_KEYS = [
  "QNOTE_CATALOG_BASE_URL",
  "QNOTE_CATALOG_APP_ID",
  "QNOTE_CATALOG_PUBLIC_KEY",
  "QNOTE_CATALOG_PRIVATE_KEY",
] as const;

describe("公共目录的内置连接信息", () => {
  const tmp = path.join(os.tmpdir(), `qnote-catalog-${process.pid}-${Date.now()}`);

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
    }
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("凭据文件读得出两个 Key，前后空格会去掉", () => {
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, "credentials.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ publicKey: " pk ", privateKey: " sk " }),
      "utf8"
    );
    expect(readCatalogCredentialFile(file)).toEqual({
      publicKey: "pk",
      privateKey: "sk",
    });
  });

  it("文件不存在或是坏 JSON → 空 Key，不抛异常", () => {
    expect(readCatalogCredentialFile(path.join(tmp, "missing.json"))).toEqual({
      publicKey: "",
      privateKey: "",
    });
    fs.mkdirSync(tmp, { recursive: true });
    const broken = path.join(tmp, "broken.json");
    fs.writeFileSync(broken, "{ 这不是 JSON", "utf8");
    expect(readCatalogCredentialFile(broken)).toEqual({
      publicKey: "",
      privateKey: "",
    });
  });

  it("站点地址与 App ID 内置着", () => {
    const defaults = resolveCatalogDefaults();
    expect(defaults.baseUrl).toBe("https://ap-northeast-1.data.tidbcloud.com");
    expect(defaults.appId).toBe("dataapp-bPMzJOGk");
  });

  it("四个字段缺一不可，缺了就不启用公共目录", () => {
    expect(
      sanitizeCatalogConfig({
        baseUrl: "https://example.test",
        appId: "app-1",
        publicKey: "pk",
      })
    ).toBeNull();
  });
});