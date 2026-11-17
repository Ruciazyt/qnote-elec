// @vitest-environment node
import { describe, it, expect } from "vitest";
import { contentHash } from "./noteHash";


describe("contentHash", () => {
  it("相同内容算出相同指纹", () => {
    expect(contentHash("同一条内容")).toBe(contentHash("同一条内容"));
  });

  it("不同内容算出不同指纹", () => {
    expect(contentHash("内容 A")).not.toBe(contentHash("内容 B"));
  });

  it("只看前 10000 字符相同、后半段不同的两条内容，指纹必须不同", () => {
    const prefix = "x".repeat(10000);
    expect(contentHash(`${prefix}尾巴一`)).not.toBe(contentHash(`${prefix}尾巴二`));
  });

  it("差一个字符指纹就不同", () => {
    expect(contentHash("内容")).not.toBe(contentHash("内"));
  });

  it("指纹是定长十六进制串", () => {
    const hash = contentHash("任意内容");

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("空内容也有确定的指纹", () => {
    expect(contentHash("")).toBe(contentHash(""));
    expect(contentHash("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("空内容与任意非空内容的指纹不同", () => {
    expect(contentHash("")).not.toBe(contentHash("x"));
  });
});
