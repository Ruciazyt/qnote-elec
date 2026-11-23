import { describe, it, expect } from "vitest";
import {
  formatDependencySpec,
  parseDependencies,
  parseDependencySpec,
  parseDependencySpecs,
  parseManifestJson,
  readPublishMetadata,
  serializeDependencies,
} from "./marketVersion";

describe("依赖规格解析", () => {
  it("只写 id 的规格", () => {
    expect(parseDependencySpec("a.b")).toEqual({ id: "a.b", range: "" });
  });

  it("带版本范围的规格", () => {
    expect(parseDependencySpec("a.b@^1.0.0")).toEqual({
      id: "a.b",
      range: "^1.0.0",
    });
  });

  it("版本范围里可以带比较符与空格", () => {
    expect(parseDependencySpec("a.b@>=1.0.0 <2.0.0")).toEqual({
      id: "a.b",
      range: ">=1.0.0 <2.0.0",
    });
  });

  it("空串与空 id 都判为无效", () => {
    expect(parseDependencySpec("")).toBeNull();
    expect(parseDependencySpec("   ")).toBeNull();
    expect(parseDependencySpec("@^1.0.0")).toBeNull();
  });

  it("格式化的结果能再解析回去", () => {
    const spec = parseDependencySpec("a.b@^1.0.0");
    expect(spec).not.toBeNull();
    expect(formatDependencySpec(spec!)).toBe("a.b@^1.0.0");
    expect(formatDependencySpec({ id: "a.b", range: "" })).toBe("a.b");
  });

  it("一组规格解析后去重并丢掉无效项", () => {
    expect(
      parseDependencySpecs(["a.b", "a.b@^2.0.0", "", "c.d@~1.2.3"])
    ).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "~1.2.3" },
    ]);
  });
});

describe("依赖的存取", () => {
  it("写进去再读出来一致", () => {
    const dependencies = [
      { id: "a.b" },
      { id: "c.d", range: "^1.0.0" },
    ];
    const text = serializeDependencies(dependencies);
    expect(parseDependencies(text)).toEqual(dependencies);
  });

  it("老记录没有这列 —— 按空数组处理", () => {
    expect(parseDependencies(null)).toEqual([]);
    expect(parseDependencies(undefined)).toEqual([]);
    expect(parseDependencies("")).toEqual([]);
  });

  it("列里的内容不是合法 JSON —— 不炸", () => {
    expect(parseDependencies("{不是 json")).toEqual([]);
    expect(parseDependencies("{}")).toEqual([]);
  });

  it("列里存的是老格式的字符串数组 —— 也能读", () => {
    expect(parseDependencies('["a.b","c.d@^1.0.0"]')).toEqual([
      { id: "a.b" },
      { id: "c.d", range: "^1.0.0" },
    ]);
  });

  it("列里已经有数组对象 —— 直接读", () => {
    expect(
      parseDependencies([{ id: "a.b", range: "^1.0.0" }, { id: "c.d" }])
    ).toEqual([{ id: "a.b", range: "^1.0.0" }, { id: "c.d" }]);
  });
});

describe("清单里的版本与依赖", () => {
  it("读出版本与依赖", () => {
    const manifest = JSON.stringify({
      id: "local.demo",
      version: "1.2.3",
      extensionDependencies: ["a.b", "c.d@^2.0.0"],
    });
    expect(readPublishMetadata(manifest)).toEqual({
      version: "1.2.3",
      dependencies: [{ id: "a.b" }, { id: "c.d", range: "^2.0.0" }],
    });
  });

  it("清单里没有这两项 —— 空值", () => {
    expect(readPublishMetadata('{"id":"local.demo"}')).toEqual({
      version: "",
      dependencies: [],
    });
  });

  it("清单不是合法 JSON —— 不炸", () => {
    expect(readPublishMetadata("not json")).toEqual({
      version: "",
      dependencies: [],
    });
    expect(parseManifestJson("[1,2]")).toBeNull();
  });
});
