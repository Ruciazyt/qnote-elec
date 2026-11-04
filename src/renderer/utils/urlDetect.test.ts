import { describe, it, expect } from "vitest";
import { detectUrl, isWebUrl } from "./urlDetect";

/**
 * 剪贴板里的网页地址识别
 *
 * 判定口径在源文件的注释里写得很死：只有**整条内容本身就是链接**才算数，
 * 且只认 http / https。这批用例锁的就是这条边界 ——
 * 放宽了，每条长文本记录都会冒出一个「打开链接」按钮；
 * 收紧了，用户从聊天里复制出来的链接反而识别不出来。
 */

describe("detectUrl", () => {
  it("认得标准 http 链接", () => {
    expect(detectUrl("https://example.com")).toBe("https://example.com/");
    expect(detectUrl("http://example.com/path")).toBe("http://example.com/path");
  });

  it("裸域名补 https 协议", () => {
    expect(detectUrl("www.example.com")).toBe("https://www.example.com/");
  });

  it("首尾空白先剥掉再判定", () => {
    expect(detectUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  it("复制时带上的成对引号会被剥掉", () => {
    expect(detectUrl('"https://example.com"')).toBe("https://example.com/");
    expect(detectUrl("“https://example.com”")).toBe("https://example.com/");
    expect(detectUrl("【https://example.com】")).toBe("https://example.com/");
  });

  it("多行内容不算链接（正文里恰好有个网址不算）", () => {
    expect(detectUrl("看看这个 https://example.com 挺好的")).toBeNull();
    expect(detectUrl("https://example.com\n第二行")).toBeNull();
  });

  it("空内容与纯空白都不是链接", () => {
    expect(detectUrl("")).toBeNull();
    expect(detectUrl("   ")).toBeNull();
  });

  it("非 http(s) 协议不放行", () => {
    expect(detectUrl("mailto:someone@example.com")).toBeNull();
    expect(detectUrl("ftp://example.com")).toBeNull();
    expect(detectUrl("file:///C:/temp/a.txt")).toBeNull();
  });

  it("不像域名的主机名不放行", () => {
    expect(detectUrl("http://foo")).toBeNull();
  });

  it("localhost 与 IP 保留（开发地址也是能打开的）", () => {
    expect(detectUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(detectUrl("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
  });

  it("普通文字不是链接", () => {
    expect(detectUrl("这是一条笔记")).toBeNull();
    expect(detectUrl("12345")).toBeNull();
    expect(detectUrl("www.c")).toBeNull();
  });
});

describe("isWebUrl", () => {
  it("与 detectUrl 的判定一致", () => {
    expect(isWebUrl("https://example.com")).toBe(true);
    expect(isWebUrl("这是一条笔记")).toBe(false);
  });
});
