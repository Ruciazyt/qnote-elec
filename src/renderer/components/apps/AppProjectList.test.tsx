import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppProjectList } from "./AppProjectList";
import type { AppProject } from "@shared/appTypes";
import { PANEL_HEADER_PADDING_X } from "@/components/panel/layout";

/**
 * 应用管理页左侧项目列表的回归
 *
 * 折叠轨道几何由 ResizableSidebar 提供（见 panel/ResizableSidebar.test.tsx），
 * 这里锁的是**内容区与头部共用同一条左缘**：
 * 侧栏头部左内边距 8px（PANEL_HEADER_PADDING_X），
 * 列表里的搜索框与项目行也得是 8px，否则折叠↔展开时内容会左右跳。
 */

const PROJECTS: AppProject[] = [
  {
    id: 1,
    name: "web",
    path: "D:\\lenovo\\gsc\\ichain-dev-console",
    status: "ready",
  },
  {
    id: 2,
    name: "notes",
    path: "D:\\personal-projects\\qnote-elec",
    status: "missing-manifest",
  },
];

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function renderList(overrides: Partial<Parameters<typeof AppProjectList>[0]> = {}) {
  const onSelect = vi.fn();
  const onImport = vi.fn();
  const utils = render(
    <AppProjectList
      projects={PROJECTS}
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

describe("应用项目列表（AppProjectList）", () => {
  describe("左缘对齐", () => {
    it("搜索框与项目列表共用同一条左缘", () => {
      const { container } = renderList();

      const root = container.firstElementChild as HTMLElement;
      const searchRow = root.children[0] as HTMLElement;
      const listRow = root.children[1] as HTMLElement;

      // px-2 = 0.5rem = 8px = PANEL_HEADER_PADDING_X
      expect(classTokens(searchRow)).toContain("px-2");
      expect(classTokens(listRow)).toContain("px-2");
      expect(PANEL_HEADER_PADDING_X).toBe(8);
    });
  });

  describe("列表内容", () => {
    it("渲染项目名，路径只显示末两段", () => {
      renderList();

      expect(screen.getByText("web")).toBeInTheDocument();
      expect(screen.getByText("…\\gsc\\ichain-dev-console")).toBeInTheDocument();
      // 前面的公共前缀不重复占地方
      expect(screen.queryByText(/lenovo/)).toBeNull();
    });

    it("选中项标 aria-current，其余不带", () => {
      renderList({ selectedId: 1 });

      const selected = screen.getByText("web").closest("button");
      const other = screen.getByText("notes").closest("button");
      expect(selected).toHaveAttribute("aria-current", "true");
      expect(other).not.toHaveAttribute("aria-current");
    });

    it("点项目回调 onSelect 并带上项目 id", async () => {
      const user = userEvent.setup();
      const { onSelect } = renderList();

      await user.click(screen.getByText("web"));

      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("运行中的项目显示运行标记", () => {
      renderList({
        runtime: { 1: { projectId: 1, status: "running", pid: 1234 } },
      });

      expect(screen.getByText("运行中")).toBeInTheDocument();
    });
  });

  describe("空态", () => {
    it("一个项目都没有时提示导入", () => {
      renderList({ projects: [] });

      expect(screen.getByText("还没有导入项目")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "导入文件夹" })).toBeInTheDocument();
    });

    it("有关键词但没匹配上时，换一句提示", () => {
      renderList({ projects: [], keyword: "zzz" });

      expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
      expect(screen.queryByText("还没有导入项目")).toBeNull();
      expect(screen.queryByRole("button", { name: "导入文件夹" })).toBeNull();
    });

    it("点导入按钮回调 onImport", async () => {
      const user = userEvent.setup();
      const { onImport } = renderList({ projects: [] });

      await user.click(screen.getByRole("button", { name: "导入文件夹" }));

      expect(onImport).toHaveBeenCalled();
    });
  });
});
