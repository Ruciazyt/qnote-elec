import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginList } from "./PluginList";
import type { PluginRecord } from "@shared/plugin/pluginTypes";
import { PANEL_HEADER_PADDING_X } from "@/components/panel/layout";

const PLUGINS: PluginRecord[] = [
  {
    localId: 1,
    id: "local.web",
    name: "web",
    version: "1.0.0",
    publisher: "local",
    path: "D:\\lenovo\\gsc\\ichain-dev-console",
    status: "ready",
    origin: "local",
    enabled: true,
  },
  {
    localId: 2,
    id: "local.notes",
    name: "notes",
    version: "0.1.0",
    publisher: "local",
    path: "D:\\personal-projects\\qnote-elec",
    status: "missing-manifest",
    origin: "local",
    enabled: true,
  },
];

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function renderList(overrides: Partial<Parameters<typeof PluginList>[0]> = {}) {
  const onSelect = vi.fn();
  const onImport = vi.fn();
  const utils = render(
    <PluginList
      plugins={PLUGINS}
      keyword=""
      onKeywordChange={vi.fn()}
      runtime={{}}
      selectedId={null}
      onSelect={onSelect}
      onImport={onImport}
      {...overrides}
    />
  );
  return { ...utils, onSelect, onImport };
}

describe("插件列表（PluginList）", () => {
  describe("左缘对齐", () => {
    it("搜索框与插件列表共用同一条左缘", () => {
      const { container } = renderList();

      const root = container.firstElementChild as HTMLElement;
      const searchRow = root.children[0] as HTMLElement;
      const listRow = root.children[1] as HTMLElement;

      expect(classTokens(searchRow)).toContain("px-2");
      expect(classTokens(listRow)).toContain("px-2");
      expect(PANEL_HEADER_PADDING_X).toBe(8);
    });
  });

  describe("列表内容", () => {
    it("渲染插件名，路径只显示末两段", () => {
      renderList();

      expect(screen.getByText("web")).toBeInTheDocument();
      expect(screen.getByText("…\\gsc\\ichain-dev-console")).toBeInTheDocument();
      expect(screen.queryByText(/lenovo/)).toBeNull();
    });

    it("选中项标 aria-current，其余不带", () => {
      renderList({ selectedId: "local.web" });

      const selected = screen.getByText("web").closest("button");
      const other = screen.getByText("notes").closest("button");
      expect(selected).toHaveAttribute("aria-current", "true");
      expect(other).not.toHaveAttribute("aria-current");
    });

    it("点插件回调 onSelect 并带上插件 id", async () => {
      const user = userEvent.setup();
      const { onSelect } = renderList();

      await user.click(screen.getByText("web"));

      expect(onSelect).toHaveBeenCalledWith("local.web");
    });

    it("运行中的插件显示运行标记", () => {
      renderList({
        runtime: {
          "local.web": { pluginId: "local.web", status: "running", pid: 1234 },
        },
      });

      expect(screen.getByText("运行中")).toBeInTheDocument();
    });
  });

  describe("空态", () => {
    it("一个插件都没有时提示导入", () => {
      renderList({ plugins: [] });

      expect(screen.getByText("还没有导入插件")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "导入文件夹" })).toBeInTheDocument();
    });

    it("有关键词但没匹配上时，换一句提示", () => {
      renderList({ plugins: [], keyword: "zzz" });

      expect(screen.getByText("没有匹配的插件")).toBeInTheDocument();
      expect(screen.queryByText("还没有导入插件")).toBeNull();
      expect(screen.queryByRole("button", { name: "导入文件夹" })).toBeNull();
    });

    it("点导入按钮回调 onImport", async () => {
      const user = userEvent.setup();
      const { onImport } = renderList({ plugins: [] });

      await user.click(screen.getByRole("button", { name: "导入文件夹" }));

      expect(onImport).toHaveBeenCalled();
    });
  });
});
