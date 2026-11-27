import { describe, expect, it } from "vitest";
import {
  MCP_SERVER_SEGMENT_MAX_LENGTH,
  MCP_TOOL_NAME_MAX_LENGTH,
  buildMcpServerRuntimeName,
  buildMcpToolRuntimeName,
  normalizeMcpNameSegment,
  shortenMcpNameSegment,
} from "../toolName";

describe("normalizeMcpNameSegment", () => {
  it("保留字母数字下划线与连字符", () => {
    expect(normalizeMcpNameSegment("my-server_1", "server")).toBe("my-server_1");
  });

  it("非法字符换成下划线并去重", () => {
    expect(normalizeMcpNameSegment("my server.list", "server")).toBe("my_server_list");
  });

  it("去掉首尾下划线", () => {
    expect(normalizeMcpNameSegment("__jira__", "server")).toBe("jira");
  });

  it("没有可用字符时退化成类型名", () => {
    expect(normalizeMcpNameSegment("测试", "server")).toBe("server");
  });

  it("控制字符被替换掉", () => {
    expect(normalizeMcpNameSegment("a b", "server")).toBe("a_b");
  });
});

describe("shortenMcpNameSegment", () => {
  it("按上限截断", () => {
    expect(shortenMcpNameSegment("abcdefgh", 4, "server")).toBe("abcd");
  });

  it("截断后不留下尾部下划线", () => {
    expect(shortenMcpNameSegment("ab_cdef", 3, "server")).toBe("ab");
  });

  it("空间不足时报错", () => {
    expect(() => shortenMcpNameSegment("abc", 0, "server")).toThrow();
  });
});

describe("buildMcpServerRuntimeName", () => {
  it("拼成 mcp__ 前缀", () => {
    expect(buildMcpServerRuntimeName("jira")).toBe("mcp__jira");
  });

  it("长度不超过服务器段上限", () => {
    const name = buildMcpServerRuntimeName("a".repeat(100));
    expect(name.length).toBeLessThanOrEqual(MCP_SERVER_SEGMENT_MAX_LENGTH + 5);
  });
});

describe("buildMcpToolRuntimeName", () => {
  it("拼成 mcp__服务器__工具", () => {
    expect(buildMcpToolRuntimeName("jira", "createIssue")).toBe(
      "mcp__jira__createIssue"
    );
  });

  it("总长度不超过上限", () => {
    const name = buildMcpToolRuntimeName("a".repeat(60), "b".repeat(60));
    expect(name.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
  });

  it("工具名被截断时仍保留服务器前缀", () => {
    const name = buildMcpToolRuntimeName("jira", "x".repeat(200));
    expect(name.startsWith("mcp__jira__")).toBe(true);
  });
});
