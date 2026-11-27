import { describe, expect, it } from "vitest";
import { formatToolResult } from "../result";

describe("formatToolResult", () => {
  it("拼接文本内容", () => {
    expect(formatToolResult({ content: [{ type: "text", text: "hello" }] })).toBe(
      "hello"
    );
  });

  it("标记调用失败", () => {
    const text = formatToolResult({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
    expect(text).toBe("调用失败：boom");
  });

  it("图片内容给出类型与体积", () => {
    const text = formatToolResult({
      content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
    });
    expect(text).toContain("图片");
    expect(text).toContain("image/png");
  });

  it("资源链接给出名称与地址", () => {
    const text = formatToolResult({
      content: [
        { type: "resource_link", name: "文档", uri: "https://example.com/doc" },
      ],
    });
    expect(text).toContain("文档");
    expect(text).toContain("https://example.com/doc");
  });

  it("没有文本时回落到结构化结果", () => {
    const text = formatToolResult({ structuredContent: { ok: true } });
    expect(text).toContain("ok");
  });

  it("空结果给出占位文案", () => {
    expect(formatToolResult({})).toBe("（无输出）");
  });
});
