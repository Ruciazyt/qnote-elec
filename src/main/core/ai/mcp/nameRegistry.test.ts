import { describe, expect, it } from "vitest";
import { McpNameRegistry } from "./nameRegistry";

describe("McpNameRegistry", () => {
  it("不同服务器分配到不同的名称段", () => {
    const registry = new McpNameRegistry();
    const segments = registry.assignServers([
      { key: "a", name: "jira" },
      { key: "b", name: "github" },
    ]);
    expect(segments.get("a")).toBe("jira");
    expect(segments.get("b")).toBe("github");
  });

  it("同名服务器不会撞名", () => {
    const registry = new McpNameRegistry();
    const segments = registry.assignServers([
      { key: "a", name: "jira" },
      { key: "b", name: "jira" },
    ]);
    expect(segments.get("a")).toBe("jira");
    expect(segments.get("b")).not.toBe("jira");
    expect(segments.get("b")).toMatch(/^jira/);
  });

  it("归一化后相同的名称也不会撞名", () => {
    const registry = new McpNameRegistry();
    const segments = registry.assignServers([
      { key: "a", name: "my server" },
      { key: "b", name: "my_server" },
    ]);
    expect(segments.get("a")).not.toBe(segments.get("b"));
  });

  it("同一服务器重复分配时保持稳定", () => {
    const registry = new McpNameRegistry();
    const first = registry.assignServers([{ key: "a", name: "jira" }]);
    const second = registry.assignServers([{ key: "a", name: "jira" }]);
    expect(second.get("a")).toBe(first.get("a"));
  });

  it("归一化后相同的工具名也不会撞名", () => {
    const registry = new McpNameRegistry();
    registry.assignServers([{ key: "a", name: "jira" }]);
    const tools = registry.assignTools("a", ["list items", "list.items", "create"]);
    const values = [...tools.values()];
    expect(new Set(values).size).toBe(3);
  });

  it("工具名可以拼成完整的运行时名称", () => {
    const registry = new McpNameRegistry();
    const segments = registry.assignServers([{ key: "a", name: "jira" }]);
    const tools = registry.assignTools("a", ["createIssue"]);
    expect("mcp__" + segments.get("a") + "__" + tools.get("createIssue")).toBe(
      "mcp__jira__createIssue"
    );
  });

  it("未分配服务器就分配工具会报错", () => {
    const registry = new McpNameRegistry();
    expect(() => registry.assignTools("missing", ["list"])).toThrow();
  });
});
