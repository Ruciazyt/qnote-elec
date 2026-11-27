// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  BUILTIN_TOOL_ENTRIES,
  listBuiltinTools,
  READ_TOOLS,
  resolveToolDisplay,
  toEntry,
  WRITE_TOOLS,
} from "../catalog";
import { GITLAB_READ_TOOLS, GITLAB_WRITE_TOOLS } from "../gitlab/index";
import { GITHUB_READ_TOOLS, GITHUB_WRITE_TOOLS } from "../github/index";

describe("内置工具目录", () => {
  it("覆盖全部内置工具", () => {
    const expected = [
      ...READ_TOOLS,
      ...WRITE_TOOLS,
      ...GITLAB_READ_TOOLS,
      ...GITLAB_WRITE_TOOLS,
      ...GITHUB_READ_TOOLS,
      ...GITHUB_WRITE_TOOLS,
    ].map((tool) => tool.name);
    expect(BUILTIN_TOOL_ENTRIES.map((entry) => entry.name).sort()).toEqual(
      expected.sort()
    );
  });

  it("工具名不重复", () => {
    const names = BUILTIN_TOOL_ENTRIES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("每条都有标题、分组与说明", () => {
    for (const entry of BUILTIN_TOOL_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("没有落到默认分组的工具", () => {
    const orphans = BUILTIN_TOOL_ENTRIES.filter(
      (entry) => entry.group === "其他"
    );
    expect(orphans.map((entry) => entry.name)).toEqual([]);
  });

  it("没登记元数据的工具也能推断分组、标题与读写类型", () => {
    const entry = toEntry({
      name: "gitlab_demo_thing",
      description: "做点事情，顺便补一句说明。",
    } as never);

    expect(entry.group).toBe("GitLab");
    expect(entry.title).toBe("做点事情");
    expect(entry.kind).toBe("read");
  });

  it("动词带写操作的工具会判成可写", () => {
    const entry = toEntry({
      name: "gitlab_create_thing",
      description: "造一个东西出来。",
    } as never);

    expect(entry.kind).toBe("write");
  });

  it("opencode 加的服务器名前缀会被还原，并查出中文标题", () => {
    expect(resolveToolDisplay("qnote_get_todos")).toEqual({
      name: "get_todos",
      title: "读取待办",
    });
  });

  it("外部 MCP 工具名原样保留", () => {
    expect(resolveToolDisplay("qnote_mcp__demo__ping")).toEqual({
      name: "mcp__demo__ping",
      title: "",
    });
  });

  it("对外只暴露必要字段", () => {
    for (const tool of listBuiltinTools()) {
      expect(Object.keys(tool).sort()).toEqual([
        "description",
        "group",
        "kind",
        "name",
        "title",
      ]);
    }
  });
});
