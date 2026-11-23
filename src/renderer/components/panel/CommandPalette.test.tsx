import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import type { PluginCommandEntry } from "@shared/plugin/manifest/pluginTypes";

const COMMANDS: PluginCommandEntry[] = [
  {
    command: "ichain.start",
    title: "启动编排台",
    category: "iChain",
    pluginId: "local.ichain",
  },
  {
    command: "demo.open",
    title: "打开示例",
    pluginId: "local.demo",
  },
];

function renderPalette(
  onRun = vi.fn(),
  commands: PluginCommandEntry[] = COMMANDS
) {
  render(
    <CommandPalette
      open
      onOpenChange={vi.fn()}
      commands={commands}
      pluginNames={{ "local.ichain": "iChain 编排台", "local.demo": "示例插件" }}
      onRun={onRun}
    />
  );
}

describe("命令面板", () => {
  it("列出插件声明的命令与所属插件", () => {
    renderPalette();

    expect(screen.getByText("iChain: 启动编排台")).toBeInTheDocument();
    expect(screen.getByText("打开示例")).toBeInTheDocument();
    expect(screen.getByText("iChain 编排台")).toBeInTheDocument();
  });

  it("输入关键词后过滤", async () => {
    renderPalette();

    await userEvent.type(screen.getByLabelText("搜索命令"), "示例");

    expect(screen.queryByText("iChain: 启动编排台")).toBeNull();
    expect(screen.getByText("打开示例")).toBeInTheDocument();
  });

  it("点命令走 onRun", async () => {
    const onRun = vi.fn();
    renderPalette(onRun);

    await userEvent.click(screen.getByText("打开示例"));

    expect(onRun).toHaveBeenCalledWith("demo.open");
  });

  it("一个命令都没有时给出提示", () => {
    renderPalette(vi.fn(), []);

    expect(screen.getByText("还没有插件命令")).toBeInTheDocument();
  });
});
