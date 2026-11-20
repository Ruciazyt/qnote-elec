// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import { describeCloudError } from "./cloudManager";
import { CatalogError } from "./catalogClient";

describe("云端错误提示", () => {
  it("401 → 认证没过", () => {
    expect(describeCloudError(new CatalogError("auth failed", 401))).toContain(
      "认证"
    );
  });

  it("403 → 权限不够", () => {
    expect(describeCloudError(new CatalogError("forbidden", 403))).toContain("权限");
  });

  it("404 → 找不到端点", () => {
    expect(
      describeCloudError(new CatalogError("endpoint not found", 404))
    ).toContain("找不到");
  });

  it("405 → 请求方法不对", () => {
    expect(describeCloudError(new CatalogError("method not allowed", 405))).toContain(
      "请求方法"
    );
  });

  it("408 → 执行超时", () => {
    expect(describeCloudError(new CatalogError("timeout", 408))).toContain("超时");
  });

  it("429 → 请求太频繁", () => {
    expect(describeCloudError(new CatalogError("too many", 429))).toContain("频繁");
  });

  it("5xx → 服务端出错", () => {
    expect(describeCloudError(new CatalogError("boom", 503))).toContain("服务端");
  });

  it("1146 → 表还没建好", () => {
    expect(
      describeCloudError(new CatalogError("table not found", 200, 1146))
    ).toContain("还没建好");
  });

  it("参数对不上 → 提示检查端点定义", () => {
    expect(
      describeCloudError(new CatalogError("param check failed!", 400, 400))
    ).toContain("端点定义");
  });

  it("超时 → 提示查网络", () => {
    expect(describeCloudError(new CatalogError("request timeout"))).toContain("超时");
  });

  it("连不上 → 提示查地址与网络", () => {
    expect(describeCloudError(new CatalogError("fetch failed"))).toContain("连不上");
  });

  it("认不出来的错误原样透出，不吞掉", () => {
    expect(describeCloudError(new CatalogError("某个说不清的原因"))).toBe(
      "某个说不清的原因"
    );
  });

  it("普通 Error 原样透出", () => {
    expect(describeCloudError(new Error("本地写库失败"))).toBe("本地写库失败");
  });

  it("空错误也有一句人话", () => {
    expect(describeCloudError(undefined)).toBe("未知错误");
  });
});
