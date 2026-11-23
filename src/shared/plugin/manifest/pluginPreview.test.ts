import { describe, it, expect } from "vitest";
import {
  isValidPort,
  parsePortText,
  parsePluginPreview,
  parseLegacyPreview,
  previewPortUrl,
  pluginPreviewAddress,
  previewToDraftText,
  normalizeManifestPreview,
} from "./pluginPreview";

describe("端口解析", () => {
  it("只认 1~65535 的整数", () => {
    expect(isValidPort(7799)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(1.5)).toBe(false);
  });

  it("文本端口要干净", () => {
    expect(parsePortText("7799")).toBe(7799);
    expect(parsePortText("  7799  ")).toBe(7799);
    expect(parsePortText("7799/")).toBeNull();
    expect(parsePortText("")).toBeNull();
  });
});

describe("预览值解析", () => {
  it("只认对象形式", () => {
    expect(parsePluginPreview({ type: "port", port: 7799 })).toEqual({
      type: "port",
      port: 7799,
    });
    expect(parsePluginPreview({ type: "url", url: "https://example.com/app" })).toEqual({
      type: "url",
      url: "https://example.com/app",
    });
    expect(parsePluginPreview({ type: "path", path: "dist/index.html" })).toEqual({
      type: "path",
      path: "dist/index.html",
    });
  });

  it("端口不合法就拒绝", () => {
    expect(parsePluginPreview({ type: "port", port: 0 })).toBeNull();
    expect(parsePluginPreview({ type: "port", port: 70000 })).toBeNull();
    expect(parsePluginPreview({ type: "port" })).toBeNull();
  });

  it("字符串与数字不是合法的预览写法", () => {
    expect(parsePluginPreview(7799)).toBeNull();
    expect(parsePluginPreview("7799")).toBeNull();
    expect(parsePluginPreview(null)).toBeNull();
    expect(parsePluginPreview(undefined)).toBeNull();
  });
});

describe("老格式预览的转换", () => {
  it("数字端口就是端口", () => {
    expect(parseLegacyPreview(7799)).toEqual({ type: "port", port: 7799 });
  });

  it("回环地址归一成端口", () => {
    expect(parseLegacyPreview("http://127.0.0.1:7788/")).toEqual({
      type: "port",
      port: 7788,
    });
    expect(parseLegacyPreview("http://localhost:7788")).toEqual({
      type: "port",
      port: 7788,
    });
  });

  it("远程地址原样当地址用", () => {
    expect(parseLegacyPreview("https://example.com/app")).toEqual({
      type: "url",
      url: "https://example.com/app",
    });
  });

  it("没带 scheme 的就是相对路径", () => {
    expect(parseLegacyPreview("dist/index.html")).toEqual({
      type: "path",
      path: "dist/index.html",
    });
  });

  it("空值没有预览", () => {
    expect(parseLegacyPreview("")).toBeNull();
    expect(parseLegacyPreview(null)).toBeNull();
    expect(parseLegacyPreview(undefined)).toBeNull();
  });
});

describe("预览值的呈现", () => {
  it("端口拼成本机地址", () => {
    expect(previewPortUrl(7788)).toBe("http://127.0.0.1:7788/");
  });

  it("地址展示：端口有地址，远程地址原样，相对路径没有地址", () => {
    expect(pluginPreviewAddress({ type: "port", port: 7788 })).toBe(
      "http://127.0.0.1:7788/"
    );
    expect(pluginPreviewAddress({ type: "url", url: "https://example.com/app" })).toBe(
      "https://example.com/app"
    );
    expect(pluginPreviewAddress({ type: "path", path: "dist/index.html" })).toBeUndefined();
    expect(pluginPreviewAddress(undefined)).toBeUndefined();
  });

  it("编辑框里回填的是端口号", () => {
    expect(previewToDraftText({ type: "port", port: 7788 })).toBe("7788");
    expect(previewToDraftText({ type: "url", url: "https://example.com" })).toBe(
      "https://example.com"
    );
    expect(previewToDraftText({ type: "path", path: "dist/index.html" })).toBe(
      "dist/index.html"
    );
  });
});

describe("发布前的清单归一化", () => {
  it("runtime.preview 已经是对象形式就不动", () => {
    const raw = JSON.stringify({
      id: "demo.x",
      runtime: { command: "node x.js", preview: { type: "port", port: 7788 } },
    });
    expect(JSON.parse(normalizeManifestPreview(raw))).toEqual(JSON.parse(raw));
  });

  it("没有 preview 的清单不动", () => {
    const raw = JSON.stringify({ id: "demo.x", runtime: { command: "node x.js" } });
    expect(JSON.parse(normalizeManifestPreview(raw))).toEqual(JSON.parse(raw));
  });

  it("不是合法 JSON 时原样返回", () => {
    expect(normalizeManifestPreview("{ 坏掉的")).toBe("{ 坏掉的");
  });
});
