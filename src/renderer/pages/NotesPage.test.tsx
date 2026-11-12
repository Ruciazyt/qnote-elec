import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../test/electron-stub";
import { NOTE_SIDEBAR_COLLAPSED_WIDTH } from "@/components/Note/layout";
import type { NoteTreeNode } from "@shared/noteTypes";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_BUTTON_SIZE,
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
 * ## 悬停才渲染的行尾按钮：user.hover + fireEvent.click
 *
 * 文件树的行尾操作按钮（重命名 / 删除）默认不渲染，悬停或选中才露出来。
 * 打开删除确认框要两步：
 *
 *   await user.hover(getTreeRow("随手记"));                      // 先让按钮出现
 *   fireEvent.click(screen.getByRole("button", { name: "删除 随手记.md" }));
 *
 * 第二步用 fireEvent.click 而不是 user.click：jsdom 里元素没有尺寸，
 * userEvent 的指针移动会先给行派发 mouseleave —— 行尾按钮靠 hovered 才渲染，
 * 于是按钮在 click 落地前就被卸载了（实测：按钮 isConnected 变 false、
 * onDelete 调用 0 次，而且不报任何错，看起来像「点了没反应」）。
 * fireEvent 只派发 click、不动 hover 状态，React 的 onClick 正常触发。
 *
 * fireEvent 自带 act 包裹，所以同步 getByRole("dialog") 就能拿到弹窗，不用等。
 *
 * 题单页删题单那批用例踩过同一个坑，写法一致。
 */

/**
 * 笔记页左栏折叠轨的回归
 *
 * 这批锁的是折叠轨几何修复：折叠轨宽 48、头部行行内 paddingLeft 8 / paddingRight 0、
 * 侧栏容器不再 items-center 居中、折叠按钮补 aria-expanded。
 *
 * 另外锁了后一轮的规范统一（笔记开发 发的需求清单）：
 * - 分栏线两态各一种画法 —— 展开态是 1px 语义边框，折叠态是画在轨道右缘的 inset 阴影
 *   （阴影不占内容盒，换成 1px 边框的话 48 轨里按钮右边会少 1px、左右就不等宽了）；
 * - 容器只过渡 width，阴影不跟着一起淡入；
 * - 侧栏标题「笔记」是 14px medium，不是 18px bold；
 * - 路径行左边线收到 8px（px-2），与头部按钮、文件树同一条线。
 *
 * jsdom 量不到真实像素，所以几何全部断言**行内样式**（style.width / style.paddingLeft /
 * style.boxShadow）与类名 —— 这两个恰好就是实现里写几何的地方。
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

/**
 * 渲染笔记页。
 *
 * tree 可以换成别的树，electron 可以塞自己的桩（断删除接口调用）。
 */
async function renderNotesPage(
  options: {
    tree?: NoteTreeNode[];
    electron?: Record<string, unknown>;
  } = {}
) {
  window.electron = createElectronStub({
    getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
    getNoteTree: vi.fn().mockResolvedValue(options.tree ?? TREE),
    // 订阅要返回退订函数（组件把它当 effect 的 cleanup 用）
    onNotesChanged: vi.fn(() => () => {}),
    ...options.electron,
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

    it("折叠态的边界线画在轨道右缘的 inset 阴影上，不占内容盒", async () => {
      await renderNotesPage();

      const sidebar = getSidebar();
      // 阴影落在最外 1px，内容盒仍是 48 —— 换成 1px 边框的话按钮右边会少 1px
      expect(sidebar.style.boxShadow).toBe("inset -1px 0 0 0 hsl(var(--border) / 0.6)");
      // 折叠态不画边框
      expect(classTokens(sidebar)).not.toContain("border-r");
    });

    it("容器只过渡宽度，阴影不跟着一起淡入", async () => {
      await renderNotesPage();

      const tokens = classTokens(getSidebar());
      expect(tokens).toContain("transition-[width]");
      expect(tokens).not.toContain("transition-all");
    });

    it("折叠轨里按钮左右各留 8px（轨宽 48 = 8 + 32 + 8）", async () => {
      await renderNotesPage();

      const header = getHeaderRow();
      const toggle = getToggle();

      // 按钮本体 32×32
      expect(classTokens(toggle)).toEqual(expect.arrayContaining(["h-8", "w-8"]));
      // 等式：轨宽 - 按钮宽 = 左右各一份内边距
      expect(NOTE_SIDEBAR_COLLAPSED_WIDTH - PANEL_COLLAPSED_BUTTON_SIZE).toBe(
        2 * PANEL_COLLAPSED_BUTTON_INSET
      );
      // 头部左内边距就是那 8，右边同宽
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(getSidebar().style.width).toBe(`${NOTE_SIDEBAR_COLLAPSED_WIDTH}px`);
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

    it("标题「笔记」是 14px medium，不是 18px bold", async () => {
      await renderNotesPage();

      const tokens = classTokens(screen.getByText("笔记"));
      expect(tokens).toContain("text-sm");
      expect(tokens).toContain("font-medium");
      expect(tokens).not.toContain("text-lg");
      expect(tokens).not.toContain("font-bold");
    });

    it("展开态用 1px 语义边框画分栏线，不再用阴影", async () => {
      await renderNotesPage();

      const sidebar = getSidebar();
      const tokens = classTokens(sidebar);
      expect(tokens).toContain("border-r");
      expect(tokens).toContain("border-border/60");
      // 展开态没有 inset 阴影
      expect(sidebar.style.boxShadow).toBe("");
      // 宽度动画只过渡 width
      expect(tokens).toContain("transition-[width]");
      expect(tokens).not.toContain("transition-all");
    });

    it("渲染路径行与文件列表", async () => {
      await renderNotesPage();

      expect(screen.getByText("D:\\notes")).toBeInTheDocument();
      // 文件行显示的是去掉扩展名的名字
      expect(screen.getByText("读书笔记")).toBeInTheDocument();
    });

    it("路径行左边线与文件树对齐（px-2 = 8px）", async () => {
      await renderNotesPage();

      // 路径文字所在的按钮 → 它的父容器就是路径行
      const pathButton = screen.getByText("D:\\notes").closest("button") as HTMLElement;
      const pathRow = pathButton.parentElement as HTMLElement;
      const tokens = classTokens(pathRow);
      expect(tokens).toContain("px-2");
      expect(tokens).not.toContain("px-3");
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

/**
 * 删除确认框的回归
 *
 * 这批锁的是「破坏性确认框文案口径」（docs/UI-GUIDELINES.md 第十节）落到笔记页：
 * - 弹窗用 ui/dialog，有 role="dialog"、有焦点管理、Esc 能关；
 * - 标题只写动作 + 对象类别（删除文件夹 / 删除笔记），**不带名字** ——
 *   标题是弹窗的可访问名称，名字太长会把它撑成一整句话；
 * - 正文由 DialogDescription 承载，aria-describedby 指得到，
 *   读屏在弹窗打开那一瞬间念得出「删的是哪一个」；
 * - 名字用「」包住，字重是 font-medium（不是 font-bold）；
 * - 不可逆提示单独一行，text-destructive。
 *
 * 断言不绑文案全文 —— 只断「描述节点里有目标名」「名字被「」包住」
 * 这类结构性事实，改措辞不会误伤。
 */

/** 名字特别长的一个条目：用来验可访问名称是完整的，不被截断 */
const LONG_NAME = "一份标题特别长的笔记用来验证可访问名称不会被截断.md";

/** 一个文件夹 + 根目录下两个文件 */
const DELETE_TREE: NoteTreeNode[] = [
  {
    kind: "folder",
    name: "读书笔记",
    relPath: "读书笔记",
    childCount: 2,
    children: [
      {
        kind: "file",
        name: "深度阅读.md",
        relPath: "读书笔记/深度阅读.md",
        path: "D:\\notes\\读书笔记\\深度阅读.md",
        type: "markdown",
        ext: ".md",
        size: 128,
        mtime: 1700000000,
      },
    ],
  },
  {
    kind: "file",
    name: "随手记.md",
    relPath: "随手记.md",
    path: "D:\\notes\\随手记.md",
    type: "markdown",
    ext: ".md",
    size: 64,
    mtime: 1700000000,
  },
  {
    // 名字特别长：用来验可访问名称是完整的，不被截断
    kind: "file",
    name: LONG_NAME,
    relPath: LONG_NAME,
    path: `D:\\notes\\${LONG_NAME}`,
    type: "markdown",
    ext: ".md",
    size: 64,
    mtime: 1700000000,
  },
];

/**
 * 文件树里那一行。
 *
 * 行本身是 role="button" 的 div；文件夹里那个展开箭头的 span 也是 role="button"，
 * 但它在名字 span 外面，closest 从名字往上找只会命中行本身。
 */
function getTreeRow(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("[role='button']") as HTMLElement;
}

/**
 * 打开某个条目的删除确认框。
 *
 * 行尾的操作按钮默认不渲染（悬停或选中才露出来），所以先悬停那一行。
 * rowText 是行上显示的文字（文件去掉了扩展名），ariaName 是按钮可访问名称里的原名。
 *
 * 用 fireEvent.click 而不是 user.click：jsdom 里元素没有尺寸，userEvent 的指针
 * 移动会先给行派发 mouseleave —— 行尾按钮靠 hovered 才渲染，于是按钮在 click
 * 落地前就被卸载了（实测：按钮 isConnected 变 false、onDelete 调用 0 次）。
 * fireEvent 只派发 click，不动 hover 状态，React 的 onClick 正常触发。
 */
async function openDeleteDialog(
  user: UserEvent,
  opts: { rowText: string; ariaName: string }
): Promise<HTMLElement> {
  await user.hover(getTreeRow(opts.rowText));
  fireEvent.click(screen.getByRole("button", { name: `删除 ${opts.ariaName}` }));
  return screen.getByRole("dialog");
}

/** 弹窗的描述节点 —— aria-describedby 指的那一段 */
function getDescription(dialog: HTMLElement): HTMLElement {
  const id = dialog.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  const node = document.getElementById(id!);
  expect(node).toBeTruthy();
  return node as HTMLElement;
}

describe("笔记页删除确认框（ui/dialog）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 展开态才有文件树
    window.localStorage.setItem(COLLAPSED_KEY, "false");
  });

  describe("删除文件夹", () => {
    it("标题只说类别不带名字，描述节点点名文件夹", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      const dialog = await openDeleteDialog(user, {
        rowText: "读书笔记",
        ariaName: "读书笔记",
      });

      // 可访问名称来自 DialogTitle：只有动作 + 对象类别
      expect(dialog).toHaveAccessibleName("删除文件夹");
      expect(dialog).not.toHaveAccessibleName(/读书笔记/);

      // 正文由 DialogDescription 承载，读屏念得到「删的是哪一个」
      const description = getDescription(dialog);
      expect(description.textContent).toContain("读书笔记");
      // 名字用「」包住
      expect(description.textContent).toContain("「读书笔记」");
    });

    it("目标名是 font-medium，不是 font-bold", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      const dialog = await openDeleteDialog(user, {
        rowText: "读书笔记",
        ariaName: "读书笔记",
      });

      const description = getDescription(dialog);
      const nameSpan = Array.from(description.querySelectorAll("span")).find(
        (el) => el.textContent?.trim() === "读书笔记"
      );
      expect(nameSpan).toBeTruthy();

      const tokens = classTokens(nameSpan!);
      expect(tokens).toContain("font-medium");
      expect(tokens).not.toContain("font-bold");
    });

    it("不可逆提示单独一行，且不是点名那一句", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      const dialog = await openDeleteDialog(user, {
        rowText: "读书笔记",
        ariaName: "读书笔记",
      });

      const description = getDescription(dialog);
      const hint = Array.from(description.querySelectorAll("*")).find(
        (el) =>
          classTokens(el).some((t) => t.includes("text-destructive")) &&
          (el.textContent ?? "").trim().length > 0
      );
      expect(hint).toBeTruthy();

      // 提示自己一段，不跟「确定要删除…」混在一起
      expect(hint!.textContent).not.toContain("确定要删除");
      // 前面是个换行 —— 单独一行
      expect(hint!.previousElementSibling?.tagName).toBe("BR");
    });

    it("Esc 能关掉弹窗", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      await openDeleteDialog(user, { rowText: "读书笔记", ariaName: "读书笔记" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("点「取消」能关掉弹窗，且不调删除接口", async () => {
      const user = userEvent.setup();
      const deleteNoteFolder = vi.fn().mockResolvedValue(true);
      await renderNotesPage({
        tree: DELETE_TREE,
        electron: { deleteNoteFolder, deleteNoteFile: vi.fn().mockResolvedValue(true) },
      });

      await openDeleteDialog(user, { rowText: "读书笔记", ariaName: "读书笔记" });
      await user.click(screen.getByRole("button", { name: "取消" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(deleteNoteFolder).not.toHaveBeenCalled();
    });

    it("点「确定删除」走 deleteNoteFolder", async () => {
      const user = userEvent.setup();
      const deleteNoteFolder = vi.fn().mockResolvedValue(true);
      const deleteNoteFile = vi.fn().mockResolvedValue(true);
      await renderNotesPage({
        tree: DELETE_TREE,
        electron: { deleteNoteFolder, deleteNoteFile },
      });

      await openDeleteDialog(user, { rowText: "读书笔记", ariaName: "读书笔记" });
      await user.click(screen.getByRole("button", { name: "确定删除" }));

      await waitFor(() =>
        expect(deleteNoteFolder).toHaveBeenCalledWith("D:\\notes", "读书笔记")
      );
      expect(deleteNoteFile).not.toHaveBeenCalled();
    });
  });

  describe("删除文件", () => {
    it("标题只说类别不带名字，描述节点点名文件", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      const dialog = await openDeleteDialog(user, {
        rowText: "随手记",
        ariaName: "随手记.md",
      });

      expect(dialog).toHaveAccessibleName("删除笔记");
      expect(dialog).not.toHaveAccessibleName(/随手记/);

      const description = getDescription(dialog);
      expect(description.textContent).toContain("随手记.md");
      expect(description.textContent).toContain("「随手记.md」");
    });

    it("点「确定删除」走 deleteNoteFile", async () => {
      const user = userEvent.setup();
      const deleteNoteFolder = vi.fn().mockResolvedValue(true);
      const deleteNoteFile = vi.fn().mockResolvedValue(true);
      await renderNotesPage({
        tree: DELETE_TREE,
        electron: { deleteNoteFolder, deleteNoteFile },
      });

      await openDeleteDialog(user, { rowText: "随手记", ariaName: "随手记.md" });
      await user.click(screen.getByRole("button", { name: "确定删除" }));

      await waitFor(() =>
        expect(deleteNoteFile).toHaveBeenCalledWith("D:\\notes", "随手记.md")
      );
      expect(deleteNoteFolder).not.toHaveBeenCalled();
    });
  });

  describe("文件树行尾按钮", () => {
    it("删除按钮的可访问名称带上该项名字，列表里多个条目能互相区分", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      await user.hover(getTreeRow("随手记"));
      expect(
        screen.getByRole("button", { name: "删除 随手记.md" })
      ).toBeInTheDocument();

      await user.hover(getTreeRow("读书笔记"));
      expect(
        screen.getByRole("button", { name: "删除 读书笔记" })
      ).toBeInTheDocument();
    });

    it("重命名按钮同理，名称是「重命名 + 目标名」", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      await user.hover(getTreeRow("随手记"));
      expect(
        screen.getByRole("button", { name: "重命名 随手记.md" })
      ).toBeInTheDocument();
    });

    it("名字很长时可访问名称仍是完整的，不截断", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      // 行上可见文字去掉了扩展名（stripExt），可访问名称带全名
      await user.hover(getTreeRow("一份标题特别长的笔记用来验证可访问名称不会被截断"));

      const del = screen.getByRole("button", {
        name: `删除 ${LONG_NAME}`,
      });
      expect(del).toHaveAttribute("aria-label", `删除 ${LONG_NAME}`);
      expect(del.getAttribute("aria-label")).toHaveLength(`删除 ${LONG_NAME}`.length);
    });

    it("确认框正文里的目标名与触发按钮的名称是同一份数据", async () => {
      const user = userEvent.setup();
      await renderNotesPage({ tree: DELETE_TREE });

      // 按钮的可访问名称里带的那个名字，就是确认框正文该点名的那个
      await user.hover(getTreeRow("随手记"));
      const trigger = screen.getByRole("button", { name: /^删除 / });
      const nameInButton = (trigger.getAttribute("aria-label") ?? "").replace(/^删除 /, "");
      expect(nameInButton).toBe("随手记.md");

      const dialog = await openDeleteDialog(user, {
        rowText: "随手记",
        ariaName: "随手记.md",
      });
      const description = getDescription(dialog);
      expect(description.textContent).toContain(`「${nameInButton}」`);
    });
  });
});

/**
 * 右键新建的落点
 *
 * 组件级用例断的是「菜单把哪个目录交出去」，这里断的是**落盘那一步**：
 * 右键某个文件夹新建，父目录必须是那个文件夹，而不是「新建位置」。
 *
 * 两者混了的后果很隐蔽：文件确实建出来了，但建在了用户没点的地方，
 * 界面上还看不出来（新建完自动打开的是新文件）。
 */
describe("笔记页右键新建（NotesPage）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 展开态才有文件树
    window.localStorage.setItem(COLLAPSED_KEY, "false");
  });

  it("右键文件夹 → 新建文件夹落在那个文件夹里", async () => {
    const user = userEvent.setup();
    const createNoteFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ tree: DELETE_TREE, electron: { createNoteFolder } });

    fireEvent.contextMenu(getTreeRow("读书笔记"), { clientX: 120, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    const input = screen.getByPlaceholderText("文件夹名称");
    await user.clear(input);
    await user.type(input, "新文件夹");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(createNoteFolder).toHaveBeenCalledWith("D:\\notes", "读书笔记", "新文件夹")
    );
  });

  it("右键文件夹 → 新建笔记落在那个文件夹里", async () => {
    const user = userEvent.setup();
    const createNoteFile = vi
      .fn()
      .mockResolvedValue({ ok: true, relPath: "读书笔记/方案.md" });
    await renderNotesPage({ tree: DELETE_TREE, electron: { createNoteFile } });

    fireEvent.contextMenu(getTreeRow("读书笔记"), { clientX: 120, clientY: 240 });
    // 「新建文件」是子菜单：先展开再选类型
    await user.click(screen.getByRole("menuitem", { name: "新建文件" }));
    await user.click(screen.getByRole("menuitem", { name: /^文本/ }));

    const input = screen.getByPlaceholderText("请输入文件名（无需后缀）");
    await user.clear(input);
    await user.type(input, "方案");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(createNoteFile).toHaveBeenCalledWith("D:\\notes", "读书笔记", "方案", "markdown")
    );
  });

  it("右键空白处 → 新建落在「新建位置」指向的目录", async () => {
    const user = userEvent.setup();
    const createNoteFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ tree: DELETE_TREE, electron: { createNoteFolder } });

    // 先把「新建位置」点到「读书笔记」上
    await user.click(getTreeRow("读书笔记"));

    const scroll = document.querySelector("[data-note-tree-scroll]") as HTMLElement;
    fireEvent.contextMenu(scroll, { clientX: 60, clientY: 300 });
    expect(screen.getByText("在「读书笔记」下新建")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    const input = screen.getByPlaceholderText("文件夹名称");
    await user.clear(input);
    await user.type(input, "新文件夹");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(createNoteFolder).toHaveBeenCalledWith("D:\\notes", "读书笔记", "新文件夹")
    );
  });
});
