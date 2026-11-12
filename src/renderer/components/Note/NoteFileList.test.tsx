import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteFileList from "./NoteFileList";
import type { NoteTreeNode } from "@shared/noteTypes";

/**
 * 笔记文件树的右键菜单
 *
 * 锁的是三件事：
 *
 * 1. 落点目录
 *    - 右键文件夹 → 新建项落在**那个文件夹里**，不是落在「新建位置」；
 *    - 右键空白处 → 落在「新建位置」指向的目录。
 *    落点搞错的话，文件会建到用户没点的地方 —— 且当场看不出来。
 *
 * 2. 菜单内容随目标变
 *    - 右键文件时不给新建项（与系统一致），给的是重命名 / 删除；
 *    - 菜单开头写明落在哪，用户不用猜。
 *
 * 3. 菜单能被关掉
 *    - Esc、点别处都关；关不掉的话菜单会一直挂在树上挡住后面的操作。
 *
 * jsdom 里没有真实布局，所以位置只断**行内样式**（left / top）——
 * 那正是实现里写坐标的地方。
 */

/** 一棵树：一个文件夹（内含一个文件）+ 根目录下的一个文件 */
const TREE: NoteTreeNode[] = [
  {
    kind: "folder",
    name: "工作",
    relPath: "工作",
    childCount: 1,
    children: [
      {
        kind: "file",
        name: "计划.md",
        relPath: "工作/计划.md",
        path: "D:\\notes\\工作\\计划.md",
        type: "markdown",
        ext: ".md",
        size: 64,
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
];

/** 渲染文件树，返回各动作的 spy */
function renderList(overrides: Partial<React.ComponentProps<typeof NoteFileList>> = {}) {
  const props = {
    nodes: TREE,
    activeRelPath: null,
    currentFolder: "归档",
    renamingRel: null,
    renameValue: "",
    renaming: false,
    onOpen: vi.fn(),
    onPickFolder: vi.fn(),
    onDelete: vi.fn(),
    onRenameStart: vi.fn(),
    onRenameChange: vi.fn(),
    onRenameConfirm: vi.fn(),
    onRenameCancel: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateFile: vi.fn(),
    onMove: vi.fn(),
    fileListRef: { current: null },
    ...overrides,
  };
  const utils = render(<NoteFileList {...props} />);
  return { ...utils, props };
}

/** 树里那一行 */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("[role='button']") as HTMLElement;
}

/** 列表的滚动容器 —— 空白处的右键落在这里 */
function scrollArea(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-note-tree-scroll]") as HTMLElement;
}

describe("笔记文件树右键菜单", () => {
  it("右键文件夹：菜单写明落点，并给出新建项", () => {
    renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("在「工作」下新建")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeInTheDocument();
  });

  it("菜单贴着指针出现", () => {
    renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("240px");
  });

  it("右键文件夹 → 新建文件夹落在那个文件夹里", async () => {
    const user = userEvent.setup();
    const { props } = renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    expect(props.onCreateFolder).toHaveBeenCalledWith("工作");
  });

  it("右键文件夹 → 新建文件落在那个文件夹里", async () => {
    const user = userEvent.setup();
    const { props } = renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });
    // 「新建文件」是子菜单：点开再选类型
    await user.click(screen.getByRole("menuitem", { name: "新建文件" }));
    await user.click(screen.getByRole("menuitem", { name: /^文本/ }));

    expect(props.onCreateFile).toHaveBeenCalledWith("markdown", "工作");
  });

  it("右键空白处 → 新建落在「新建位置」指向的目录", async () => {
    const user = userEvent.setup();
    const { container, props } = renderList({ currentFolder: "归档" });

    fireEvent.contextMenu(scrollArea(container), { clientX: 60, clientY: 300 });

    expect(screen.getByText("在「归档」下新建")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    expect(props.onCreateFolder).toHaveBeenCalledWith("归档");
  });

  it("右键文件：不给新建项，给的是打开 / 重命名 / 删除", () => {
    renderList();

    fireEvent.contextMenu(rowOf("随手记"), { clientX: 80, clientY: 200 });

    expect(screen.queryByRole("menuitem", { name: "新建文件" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "新建文件夹" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("右键文件 → 重命名走的是行内重命名", async () => {
    const user = userEvent.setup();
    const { props } = renderList();

    fireEvent.contextMenu(rowOf("随手记"), { clientX: 80, clientY: 200 });
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));

    expect(props.onRenameStart).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "file", relPath: "随手记.md" })
    );
  });

  it("Esc 关掉菜单", () => {
    renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("点别处关掉菜单", () => {
    renderList();

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("没设置笔记目录时，新建项是禁用的", () => {
    renderList({ canCreateFile: false });

    fireEvent.contextMenu(rowOf("工作"), { clientX: 120, clientY: 240 });

    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeDisabled();
    expect(screen.getByText("请先设置笔记保存目录")).toBeInTheDocument();
  });
});
