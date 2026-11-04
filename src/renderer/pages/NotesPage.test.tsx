import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../test/electron-stub";
import { NOTE_SIDEBAR_COLLAPSED_WIDTH } from "@/components/Note/layout";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";

/**
 * 白板编辑器换成空组件。
 *
 * NotesPage 默认就挂着 excalidraw 标签（visitedTypes 初始值是 ["excalidraw"]），
 * 懒加载会拉进 @excalidraw/excalidraw → open-color；而 open-color 的 ESM 入口
 * 写的是 `import colors from "./open-color.json"`，Node 原生 ESM 要求 JSON 导入
 * 带 import attribute，直接加载会抛
 * 「needs an import attribute of "type: json"」。
 *
 * 这批用例只关心左栏几何，不关心白板，所以直接把它 mock 掉。
 */
vi.mock("@/components/Note/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});

/**
 * 笔记页左栏折叠轨的回归
 *
 * 这批锁的是折叠轨几何修复：折叠轨宽 48、头部行行内 paddingLeft 8 / paddingRight 0、
 * 侧栏容器不再 items-center 居中、折叠按钮补 aria-expanded。
 *
 * jsdom 量不到真实像素，所以几何全部断言**行内样式**（style.width / style.paddingLeft）
 * 与类名 —— 这两个恰好就是实现里写几何的地方。
 */

/** useCollapsedState 的 key */
const COLLAPSED_KEY = "notes-sidebar-collapsed";
/** useNoteSidebarWidth 的 key（宽度偏好） */
const WIDTH_KEY = "qnote-notes-sidebar-width";

/** 一棵只有一个文件的笔记树 */
const TREE = [
  {
    kind: "file" as const,
    relPath: "读书笔记.md",
    name: "读书笔记.md",
    type: "markdown" as const,
    mtime: 1700000000,
    children: [],
  },
];

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

async function renderNotesPage() {
  window.electron = createElectronStub({
    getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
    getNoteTree: vi.fn().mockResolvedValue(TREE),
    // 订阅要返回退订函数（组件把它当 effect 的 cleanup 用）
    onNotesChanged: vi.fn(() => () => {}),
  });

  const utils = render(
    <MemoryRouter initialEntries={["/notes"]}>
      <NotesPage />
    </MemoryRouter>
  );

  // 把 loadTree 的 promise 链跑完
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });

  return utils;
}

/** 左栏容器 */
function getSidebar(): HTMLElement {
  const root = document.querySelector(".relative.z-10") as HTMLElement;
  return root;
}

/** 左栏头部行 —— 侧栏的第一个子元素 */
function getHeaderRow(): HTMLElement {
  return getSidebar().firstElementChild as HTMLElement;
}

/** 折叠 / 收起按钮 */
function getToggle(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(展开侧栏|收起侧栏)$/ }) as HTMLButtonElement;
}

describe("笔记页左栏折叠轨（NotesPage）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("折叠态", () => {
    beforeEach(() => {
      window.localStorage.setItem(COLLAPSED_KEY, "true");
    });

    it("按钮标为「展开侧栏」，aria-expanded 为 false，图标指向右", async () => {
      await renderNotesPage();

      const toggle = getToggle();
      expect(toggle).toHaveAttribute("aria-label", "展开侧栏");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-right");
    });

    it("头部行左内边距 8px、右内边距 0px", async () => {
      await renderNotesPage();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(header.style.paddingRight).toBe("0px");
    });

    it("侧栏轨宽 48px，容器不带 items-center 居中", async () => {
      await renderNotesPage();

      const sidebar = getSidebar();
      expect(sidebar.style.width).toBe(`${NOTE_SIDEBAR_COLLAPSED_WIDTH}px`);
      expect(NOTE_SIDEBAR_COLLAPSED_WIDTH).toBe(48);
      // 轨道右侧没有边框居中问题，但父容器一旦居中按钮就会横跳
      expect(classTokens(sidebar)).not.toContain("items-center");
    });

    it("不渲染标题、路径行与文件列表", async () => {
      await renderNotesPage();

      expect(screen.queryByText("笔记")).toBeNull();
      expect(screen.queryByText("D:\\notes")).toBeNull();
      // 文件行显示的是去掉扩展名的名字
      expect(screen.queryByText("读书笔记")).toBeNull();
    });

    it("不渲染拖拽分割线（侧栏已经退化成一条按钮轨）", async () => {
      await renderNotesPage();

      expect(screen.queryByRole("slider", { name: "调整侧栏宽度" })).toBeNull();
    });
  });

  describe("展开态", () => {
    beforeEach(() => {
      window.localStorage.setItem(COLLAPSED_KEY, "false");
    });

    it("按钮标为「收起侧栏」，aria-expanded 为 true，图标指向左", async () => {
      await renderNotesPage();

      const toggle = getToggle();
      expect(toggle).toHaveAttribute("aria-label", "收起侧栏");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-left");
    });

    it("头部行左右内边距都是 8px", async () => {
      await renderNotesPage();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe(`${PANEL_HEADER_PADDING_X}px`);
      expect(header.style.paddingRight).toBe(`${PANEL_HEADER_PADDING_X}px`);
    });

    it("渲染标题「笔记」，且位于按钮之后", async () => {
      await renderNotesPage();

      const heading = screen.getByText("笔记");
      const toggle = getToggle();

      // DOCUMENT_POSITION_FOLLOWING 表示标题在按钮之后
      expect(
        toggle.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("渲染路径行与文件列表", async () => {
      await renderNotesPage();

      expect(screen.getByText("D:\\notes")).toBeInTheDocument();
      // 文件行显示的是去掉扩展名的名字
      expect(screen.getByText("读书笔记")).toBeInTheDocument();
    });

    it("侧栏宽度取持久化的展开宽度", async () => {
      window.localStorage.setItem(WIDTH_KEY, "400");
      await renderNotesPage();

      expect(getSidebar().style.width).toBe("400px");
    });

    it("渲染拖拽分割线，其当前宽度就是已持久化的宽度", async () => {
      window.localStorage.setItem(WIDTH_KEY, "400");
      await renderNotesPage();

      expect(screen.getByRole("slider", { name: "调整侧栏宽度" })).toHaveAttribute(
        "aria-valuenow",
        "400"
      );
    });
  });

  describe("折叠与展开的切换", () => {
    beforeEach(() => {
      window.localStorage.setItem(COLLAPSED_KEY, "true");
    });

    it("点一下按钮，aria-label 与 aria-expanded 同步翻转", async () => {
      const user = userEvent.setup();
      await renderNotesPage();

      await user.click(getToggle());

      const toggle = screen.getByRole("button", { name: "收起侧栏" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-left");
    });

    it("右内边距由 0 变 8，左内边距两态都保持 8（切换时按钮 x 不变）", async () => {
      const user = userEvent.setup();
      await renderNotesPage();

      const header = getHeaderRow();
      expect(header.style.paddingLeft).toBe("8px");
      expect(header.style.paddingRight).toBe("0px");

      await user.click(getToggle());

      expect(header.style.paddingLeft).toBe("8px");
      expect(header.style.paddingRight).toBe("8px");
    });

    it("折叠状态写进 localStorage 的既有 key", async () => {
      const user = userEvent.setup();
      await renderNotesPage();

      expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("true");

      await user.click(getToggle());

      expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe("false");
    });

    it("折叠/展开来回切换不改动已持久化的展开宽度", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(WIDTH_KEY, "400");
      await renderNotesPage();

      // 折叠态：轨道宽 48，但存着的展开宽度不能被改写
      expect(getSidebar().style.width).toBe("48px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("400");

      // 展开态：宽度回到拖出来的那一档
      await user.click(getToggle());
      expect(getSidebar().style.width).toBe("400px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("400");

      // 再折回去，宽度依旧只是显示成轨道宽，存的那一档没动
      await user.click(getToggle());
      expect(getSidebar().style.width).toBe("48px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("400");
    });
  });

  describe("拖拽调宽", () => {
    beforeEach(() => {
      window.localStorage.setItem(COLLAPSED_KEY, "false");
      window.localStorage.setItem(WIDTH_KEY, "288");
    });

    it("拖拽分割线能调宽，宽度写进 localStorage", async () => {
      const user = userEvent.setup();
      await renderNotesPage();

      const resizer = screen.getByRole("slider", { name: "调整侧栏宽度" });

      // 侧栏在左，往右拖是加宽
      await user.pointer([
        { keys: "[MouseLeft>]", target: resizer, coords: { clientX: 100, clientY: 100 } },
        { target: document.body, coords: { clientX: 130, clientY: 100 } },
        { keys: "[/MouseLeft]" },
      ]);

      expect(getSidebar().style.width).toBe("318px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("318");
    });

    it("键盘方向键也能调宽", async () => {
      const user = userEvent.setup();
      await renderNotesPage();

      const resizer = screen.getByRole("slider", { name: "调整侧栏宽度" });
      resizer.focus();
      await user.keyboard("{ArrowRight}");

      // 键盘步长 16
      expect(getSidebar().style.width).toBe("304px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("304");
    });
  });
});
