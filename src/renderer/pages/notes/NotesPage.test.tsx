import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../../test/electron-stub";
import { NOTE_SIDEBAR_COLLAPSED_WIDTH } from "@/pages/notes/layout";
import type { NoteTreeNode } from "@shared/notes/noteTypes";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_BUTTON_SIZE,
  PANEL_HEADER_PADDING_X,
} from "@/components/panel/layout";

vi.mock("@/pages/notes/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});



const COLLAPSED_KEY = "notes-sidebar-collapsed";
const WIDTH_KEY = "qnote-notes-sidebar-width";

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

async function renderNotesPage(
  options: {
    tree?: NoteTreeNode[];
    electron?: Record<string, unknown>;
  } = {}
) {
  window.electron = createElectronStub({
    getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
    getNoteTree: vi.fn().mockResolvedValue(options.tree ?? TREE),
    onNotesChanged: vi.fn(() => () => {}),
    ...options.electron,
  });

  const utils = render(
    <MemoryRouter initialEntries={["/notes"]}>
      <NotesPage />
    </MemoryRouter>
  );

  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });

  return utils;
}

function getSidebar(): HTMLElement {
  const root = document.querySelector(".relative.z-10") as HTMLElement;
  return root;
}

function getHeaderRow(): HTMLElement {
  return getSidebar().firstElementChild as HTMLElement;
}

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
      expect(classTokens(sidebar)).not.toContain("items-center");
    });

    it("折叠态的边界线画在轨道右缘的 inset 阴影上，不占内容盒", async () => {
      await renderNotesPage();

      const sidebar = getSidebar();
      expect(sidebar.style.boxShadow).toBe("inset -1px 0 0 0 hsl(var(--border) / 0.6)");
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

      expect(classTokens(toggle)).toEqual(expect.arrayContaining(["h-8", "w-8"]));
      expect(NOTE_SIDEBAR_COLLAPSED_WIDTH - PANEL_COLLAPSED_BUTTON_SIZE).toBe(
        2 * PANEL_COLLAPSED_BUTTON_INSET
      );
      expect(header.style.paddingLeft).toBe(`${PANEL_COLLAPSED_BUTTON_INSET}px`);
      expect(getSidebar().style.width).toBe(`${NOTE_SIDEBAR_COLLAPSED_WIDTH}px`);
    });

    it("不渲染标题、路径行与文件列表", async () => {
      await renderNotesPage();

      expect(screen.queryByText("笔记")).toBeNull();
      expect(screen.queryByText("D:\\notes")).toBeNull();
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
      expect(sidebar.style.boxShadow).toBe("");
      expect(tokens).toContain("transition-[width]");
      expect(tokens).not.toContain("transition-all");
    });

    it("渲染路径行与文件列表", async () => {
      await renderNotesPage();

      expect(screen.getByText("D:\\notes")).toBeInTheDocument();
      expect(screen.getByText("读书笔记")).toBeInTheDocument();
    });

    it("路径行左边线与文件树对齐（px-2 = 8px）", async () => {
      await renderNotesPage();

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

      expect(getSidebar().style.width).toBe("48px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("400");

      await user.click(getToggle());
      expect(getSidebar().style.width).toBe("400px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("400");

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

      expect(getSidebar().style.width).toBe("304px");
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe("304");
    });
  });
});


const LONG_NAME = "一份标题特别长的笔记用来验证可访问名称不会被截断.md";

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

function getTreeRow(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("[role='button']") as HTMLElement;
}

async function openDeleteDialog(
  user: UserEvent,
  opts: { rowText: string; ariaName: string }
): Promise<HTMLElement> {
  await user.hover(getTreeRow(opts.rowText));
  fireEvent.click(screen.getByRole("button", { name: `删除 ${opts.ariaName}` }));
  return screen.getByRole("dialog");
}

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

      expect(dialog).toHaveAccessibleName("删除文件夹");
      expect(dialog).not.toHaveAccessibleName(/读书笔记/);

      const description = getDescription(dialog);
      expect(description.textContent).toContain("读书笔记");
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

      expect(hint!.textContent).not.toContain("确定要删除");
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

describe("笔记页右键新建（NotesPage）", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

describe("笔记页的「在文件管理器中显示」（NotesPage）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(COLLAPSED_KEY, "false");
  });

  it("右键文件 → revealInFolder 定位到笔记根目录下的那个文件", async () => {
    const user = userEvent.setup();
    const revealInFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ tree: DELETE_TREE, electron: { revealInFolder } });

    fireEvent.contextMenu(getTreeRow("随手记"), { clientX: 120, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "在文件夹中显示" }));

    await waitFor(() =>
      expect(revealInFolder).toHaveBeenCalledWith("D:\\notes", "随手记.md")
    );
  });

  it("右键文件夹 → openInExplorer 打开那个目录本身", async () => {
    const user = userEvent.setup();
    const openInExplorer = vi.fn().mockResolvedValue("");
    await renderNotesPage({ tree: DELETE_TREE, electron: { openInExplorer } });

    fireEvent.contextMenu(getTreeRow("读书笔记"), { clientX: 120, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "在文件管理器中打开" }));

    await waitFor(() =>
      expect(openInExplorer).toHaveBeenCalledWith("D:\\notes", "读书笔记")
    );
  });
});
