import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "./schema";
import { parseArgsLines, parseKeyValueLines } from "../../../../shared/ai/mcp";

describe("jsonSchemaToZod", () => {
  const schema = jsonSchemaToZod({
    type: "object",
    properties: {
      title: { type: "string" },
      count: { type: "integer" },
      ratio: { type: "number" },
      flag: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
      mode: { enum: ["fast", "slow"] },
      nested: {
        type: "object",
        properties: { deep: { type: "string" } },
        required: ["deep"],
      },
    },
    required: ["title"],
  });

  it("必填字段缺失时报错", () => {
    expect(schema.safeParse({ count: 1 }).success).toBe(false);
  });

  it("可选字段缺失时不报错", () => {
    expect(schema.safeParse({ title: "x" }).success).toBe(true);
  });

  it("按类型校验", () => {
    expect(schema.safeParse({ title: "x", count: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ title: "x", count: 2 }).success).toBe(true);
    expect(schema.safeParse({ title: "x", flag: "yes" }).success).toBe(false);
    expect(schema.safeParse({ title: "x", tags: ["a", "b"] }).success).toBe(true);
    expect(schema.safeParse({ title: "x", mode: "fast" }).success).toBe(true);
    expect(schema.safeParse({ title: "x", mode: "other" }).success).toBe(false);
  });

  it("嵌套对象的必填项也生效", () => {
    expect(schema.safeParse({ title: "x", nested: {} }).success).toBe(false);
    expect(schema.safeParse({ title: "x", nested: { deep: "v" } }).success).toBe(true);
  });

  it("空 schema 退化成任意对象", () => {
    const loose = jsonSchemaToZod(undefined);
    expect(loose.safeParse({ anything: 1 }).success).toBe(true);
  });

  it("anyOf 走联合类型", () => {
    const union = jsonSchemaToZod({
      type: "object",
      properties: {
        value: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    });
    expect(union.safeParse({ value: "x" }).success).toBe(true);
    expect(union.safeParse({ value: 1 }).success).toBe(true);
    expect(union.safeParse({ value: true }).success).toBe(false);
  });

  it("允许额外字段时不会被拦下", () => {
    const loose = jsonSchemaToZod({
      type: "object",
      properties: { a: { type: "string" } },
    });
    expect(loose.safeParse({ a: "x", b: 1 }).success).toBe(true);
  });

  it("声明 additionalProperties false 时拦下额外字段", () => {
    const strict = jsonSchemaToZod({
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    });
    expect(strict.safeParse({ a: "x", b: 1 }).success).toBe(false);
  });
});

describe("parseKeyValueLines", () => {
  it("解析 KEY=VALUE，忽略空行和注释", () => {
    expect(parseKeyValueLines("A=1\n\n# 注释\nB=two=three")).toEqual({
      A: "1",
      B: "two=three",
    });
  });

  it("没有等号的行被忽略", () => {
    expect(parseKeyValueLines("nonsense")).toEqual({});
  });
});

describe("parseArgsLines", () => {
  it("每行一个参数，去掉空行", () => {
    expect(parseArgsLines("-y\n  package  \n\n")).toEqual(["-y", "package"]);
  });
});
