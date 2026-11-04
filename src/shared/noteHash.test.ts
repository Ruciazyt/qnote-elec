// @vitest-environment node
import { describe, it, expect } from "vitest";
import { contentHash } from "./noteHash";

/**
 * 笔记内容指纹
 *
 * 剪贴板去重（写入时）与历史数据回填（迁移时）必须算出同一个值，
 * 否则回填出来的 content_hash 和新写入的对不上，索引等于没建。
 *
 * 这条最怕的不是「算错」，而是「算得不一样」——
 * 一旦两处用了不同实现（或同一个实现在某次改动后变了），
 * 去重会静默失效：用户看到的是同一条内容被反复记了好几遍。
 */

describe("contentHash", () => {
  it("相同内容算出相同指纹", () => {
    expect(contentHash("同一条内容")).toBe(contentHash("同一条内容"));
  });

  it("不同内容算出不同指纹", () => {
    expect(contentHash("内容 A")).not.toBe(contentHash("内容 B"));
  });

  it("只看前 10000 字符相同、后半段不同的两条内容，指纹必须不同", () => {
    // 这是「必须全量」的由来：早先的宽松指纹只取前 10000 字符，
    // 两条内容不同但前 10000 字符相同的笔记会被误判成重复而丢弃。
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
