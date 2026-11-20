import { describe, it, expect } from "vitest";
import {
  isValidPort,
  parsePortText,
  parsePreviewSpec,
  previewPortUrl,
  previewAddressOf,
  previewToDraftText,
  normalizePreviewValue,
  normalizeManifestPreview,
} from "./preview";

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
  it("数字端口就是端口", () => {
    expect(parsePreviewSpec(7799)).toEqual({ kind: "port", port: 7799 });
    expect(parsePreviewSpec(0)).toBeNull();
  });

  it("回环地址归一成端口", () => {
    expect(parsePreviewSpec("http://127.0.0.1:7788/")).toEqual({
      kind: "port",
      port: 7788,
    });
    expect(parsePreviewSpec("http://localhost:7788")).toEqual({
      kind: "port",
      port: 7788,
    });
  });

  it("远程地址原样当地址用", () => {
    expect(parsePreviewSpec("https://example.com/app")).toEqual({
      kind: "url",
      url: "https://example.com/app",
    });
  });

  it("没带 scheme 的就是相对路径", () => {
    expect(parsePreviewSpec("dist/index.html")).toEqual({
      kind: "path",
      path: "dist/index.html",
    });
  });

  it("空值没有预览", () => {
    expect(parsePreviewSpec("")).toBeNull();
    expect(parsePreviewSpec(null)).toBeNull();
    expect(parsePreviewSpec(undefined)).toBeNull();
  });
});

describe("预览值的呈现", () => {
  it("端口拼成本机地址", () => {
    expect(previewPortUrl(7788)).toBe("http://127.0.0.1:7788/");
  });

  it("地址展示：端口有地址，远程地址原样，相对路径没有地址", () => {
    expect(previewAddressOf(7788)).toBe("http://127.0.0.1:7788/");
    expect(previewAddressOf("https://example.com/app")).toBe(
      "https://example.com/app"
    );
    expect(previewAddressOf("dist/index.html")).toBeUndefined();
  });

  it("编辑框里回填的是端口号", () => {
    expect(previewToDraftText(7788)).toBe("7788");
    expect(previewToDraftText("http://127.0.0.1:7788/")).toBe("7788");
    expect(previewToDraftText("dist/index.html")).toBe("dist/index.html");
  });

  it("归一化把回环地址换成端口", () => {
    expect(normalizePreviewValue("http://127.0.0.1:7788/")).toBe(7788);
    expect(normalizePreviewValue("https://example.com/app")).toBe(
      "https://example.com/app"
    );
    expect(normalizePreviewValue("")).toBeUndefined();
  });
});

describe("发布前的清单归一化", () => {
  it("回环预览地址换成端口（清单里不再有 IP 字面量）", () => {
    const raw = JSON.stringify({
      name: "iChain Dev Console",
      command: "node server.mjs",
      preview: "http://127.0.0.1:7788/",
    });

    const parsed = JSON.parse(normalizeManifestPreview(raw));
    expect(parsed.preview).toBe(7788);
    expect(parsed.name).toBe("iChain Dev Console");
    expect(normalizeManifestPreview(raw)).not.toContain("127.0.0.1");
  });

  it("已经是端口的清单不动", () => {
    const raw = JSON.stringify({ name: "x", preview: 7788 });
    expect(normalizeManifestPreview(raw)).toBe(raw);
  });

  it("没有 preview 的清单不动", () => {
    const raw = JSON.stringify({ name: "x", command: "node x.js" });
    expect(normalizeManifestPreview(raw)).toBe(raw);
  });

  it("不是合法 JSON 时原样返回", () => {
    expect(normalizeManifestPreview("{ 坏掉的")).toBe("{ 坏掉的");
  });
});
