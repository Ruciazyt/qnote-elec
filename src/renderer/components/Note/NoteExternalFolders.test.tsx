import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import NoteExternalFolders from "./NoteExternalFolders";
import type { ExternalFolder, NoteTreeNode } from "@shared/noteTypes";

/**
 * 外部文件夹面板（笔记侧栏下半部分）
 *
 * 锁的是四件事：
 *
 * 1. 整块可收起
 *    默认收起，但标题行始终在 —— "添加文件夹"的入口不能被收进折叠层里。
 *
 * 2. 展开某个文件夹时才去读它的树
 *    目录树由父组件读（onToggleFolder），组件自己不碰 IO。
 *
 * 3. 点文件能打开
 *    文件夹 + 相对路径一起交给父组件 —— 只给相对路径的话，
 *    主树里同名同路径的文件会被认错。
 *
 * 4. 移除只动清单
 *    移除按钮走 onRemove，磁盘上的文件不在这一步的管辖范围内。
 */

const FOLDERS: ExternalFolder[] = [
  { id: "ext-1", path: "D:\\资料\\工作", name: "工作" },
];

/** 外部文件夹里的树：一个子文件夹 + 两个文件 */
const TREE: NoteTreeNode[] = [
  {
    kind: "folder",
    name: "归档",
    relPath: "归档",
    childCount: 1,
    children: [
      {
        kind: "file",
        name: "旧方案.md",
        relPath: "归档/旧方案.md",
        path: "D:\\资料\\工作\\归档\\旧方案.md",
        type: "markdown",
        ext: ".md",
        size: 64,
        mtime: 1700000000,
      },
    ],
  },
  {
    kind: "file",
    name: "会议纪要.md",
    relPath: "会议纪要.md",
    path: "D:\\资料\\工作\\会议纪要.md",
    type: "markdown",
    ext: ".md",
    size: 64,
    mtime: 1700000000,
  },
];

/**
 * 自持状态的壳
 *
 * 收起状态由父组件掌握 —— 父组件要靠它给这一块定高度
 * （收起时只留标题行，主树把空出来的高度全拿走）。
 * 组件自己不再读 localStorage，所以这里用一个壳来提供状态。
 */
function ControlledPanel(
  props: Omit<
    React.ComponentProps<typeof NoteExternalFolders>,
    "collapsed" | "onToggleCollapsed"
  >
) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <NoteExternalFolders
      {...props}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((v) => !v)}
    />
  );
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof NoteExternalFolders>> = {}
) {
  const props = {
    folders: FOLDERS,
    trees: { "ext-1": TREE },
    loadingIds: new Set<string>(),
    onToggleFolder: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onRefresh: vi.fn(),
    onOpenFile: vi.fn(),
    onDelete: vi.fn(),
    onRenameConfirm: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateFile: vi.fn(),
    onMove: vi.fn(),
    onImportFiles: vi.fn(),
    activeFolderId: null,
    activeRelPath: null,
    ...overrides,
  };
  const utils = render(<ControlledPanel {...props} />);
  return { ...utils, props };
}

/** 文件树里那一行（行本身是 role="button" 的 div） */
function rowOf(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("[role='button']") as HTMLElement;
}

/**
 * 第几棵树的滚动区 —— 空白处的右键落在这里
 *
 * 新建 / 刷新只在右键菜单里，工具栏那排图标按钮已经撤掉，
 * 所以要触发新建得右键树的空白处。
 */
function scrollAreaOf(index: number): HTMLElement {
  const area = document.querySelectorAll<HTMLElement>("[data-note-tree-scroll]")[index];
  if (!area) throw new Error(`没有第 ${index} 棵树的滚动区`);
  return area;
}

/** 展开外部文件夹区，并展开其中那个「工作」文件夹，让树渲染出来 */
async function expandTree(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
  await user.click(screen.getByText("工作"));
}

describe("外部文件夹面板", () => {
  beforeEach(() => {
    // 收起状态由 ControlledPanel 持有（默认收起），用例之间天然隔开
  });

  it("默认收起，但标题行和添加入口始终在", () => {
    renderPanel();

    expect(screen.getByText("外部文件夹")).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加现有文件夹" })).toBeTruthy();
    // 收起来了就不该露出文件夹条目
    expect(screen.queryByText("工作")).toBeNull();
  });

  /**
   * 收起是「缩下去 + 淡出」，不是瞬切
   *
   * 高度在缩的时候文字必须还在 —— 直接卸载的话肉眼看到的是
   * 「文字先没了，底下的框再缩」，两件事对不上。
   */
  it("收起时内容先留在原地，动画走完才卸载", async () => {
    vi.useFakeTimers();
    try {
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: "展开外部文件夹" }));
      expect(screen.getByText("工作")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "收起外部文件夹" }));
      // 退场进行中：内容还在
      expect(screen.getByText("工作")).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      // 动画走完 → 卸载
      expect(screen.queryByText("工作")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("点标题行展开后能看到已登记的文件夹", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));

    expect(screen.getByText("工作")).toBeTruthy();
  });

  it("展开某个文件夹会通知父组件去读它的树", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));

    expect(props.onToggleFolder).toHaveBeenCalledWith("ext-1");
  });

  it("树里的文件能点开，并带上所属文件夹", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));
    await user.click(screen.getByText("会议纪要"));

    expect(props.onOpenFile).toHaveBeenCalledTimes(1);
    const [folder, node] = props.onOpenFile.mock.calls[0] as unknown as [
      ExternalFolder,
      { relPath: string }
    ];
    expect(folder.id).toBe("ext-1");
    expect(node.relPath).toBe("会议纪要.md");
  });

  it("移除只走 onRemove —— 磁盘上的文件不由这一步处理", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByRole("button", { name: "移除 工作" }));

    expect(props.onRemove).toHaveBeenCalledWith("ext-1");
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });

  it("一个文件夹都没加时给出提示", async () => {
    const user = userEvent.setup();
    renderPanel({ folders: [] });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));

    expect(screen.getByText(/还没有添加文件夹/)).toBeTruthy();
  });
});

/**
 * 外部文件夹区的文件管理（增删改）
 *
 * 外部区没有另写一套行 —— 它直接把主树的 NoteFileList 挂在下面，
 * 所以行尾按钮、右键菜单、工具栏新建都是主树那套。
 * 这里锁的是「这些主树的动作落到外部树上时，带的是外部文件夹的 id」。
 *
 * 最容易错的地方：主树里的删除 / 重命名 / 新建都作用在笔记根目录，
 * 外部树上必须换成外部文件夹 —— 只给 relPath 的话，
 * 主进程分不清该动哪个根，会误删笔记根目录下的同名文件。
 */
describe("外部文件夹的文件管理", () => {
  beforeEach(() => {
    // 收起状态由 ControlledPanel 持有，用例之间天然隔开
  });

  it("行尾的删除按钮带上所属文件夹", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await expandTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "删除 会议纪要.md" }));

    expect(props.onDelete).toHaveBeenCalledTimes(1);
    const [folder, node] = props.onDelete.mock.calls[0] as unknown as [
      ExternalFolder,
      { relPath: string }
    ];
    expect(folder.id).toBe("ext-1");
    expect(node.relPath).toBe("会议纪要.md");
  });

  it("右键菜单里的「删除」同样带上所属文件夹", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await expandTree(user);
    fireEvent.contextMenu(rowOf("会议纪要"), { clientX: 100, clientY: 200 });
    await user.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(props.onDelete).toHaveBeenCalledTimes(1);
    const [folder] = props.onDelete.mock.calls[0] as unknown as [ExternalFolder];
    expect(folder.id).toBe("ext-1");
  });

  it("重命名：新名字不带扩展名，带的是所属文件夹", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await expandTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "重命名 会议纪要.md" }));

    const input = document.querySelector("[data-rename-input]") as HTMLInputElement;
    expect(input).toBeTruthy();
    // 文件重命名时输入框里不带扩展名 —— 扩展名跟着类型走，不该让用户改
    expect(input.value).toBe("会议纪要");

    await user.clear(input);
    await user.type(input, "新纪要");
    await user.keyboard("{Enter}");

    expect(props.onRenameConfirm).toHaveBeenCalledTimes(1);
    const [folder, node, newName] = props.onRenameConfirm.mock.calls[0] as unknown as [
      ExternalFolder,
      { relPath: string },
      string
    ];
    expect(folder.id).toBe("ext-1");
    expect(node.relPath).toBe("会议纪要.md");
    expect(newName).toBe("新纪要");
  });

  it("右键空白处「新建文件夹」落在当前新建位置", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await expandTree(user);
    fireEvent.contextMenu(scrollAreaOf(0), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    expect(props.onCreateFolder).toHaveBeenCalledTimes(1);
    const [folder, target] = props.onCreateFolder.mock.calls[0] as unknown as [
      ExternalFolder,
      string
    ];
    expect(folder.id).toBe("ext-1");
    // 默认落在外部文件夹的根下
    expect(target).toBe("");
  });

  it("右键空白处「新建文件」选类型后落进外部文件夹", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    await expandTree(user);
    fireEvent.contextMenu(scrollAreaOf(0), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件" }));
    await user.click(screen.getByRole("menuitem", { name: /^文本/ }));

    expect(props.onCreateFile).toHaveBeenCalledTimes(1);
    const [folder, type, target] = props.onCreateFile.mock.calls[0] as unknown as [
      ExternalFolder,
      string,
      string
    ];
    expect(folder.id).toBe("ext-1");
    expect(type).toBe("markdown");
    expect(target).toBe("");
  });

  it("每棵外部树各自维护新建位置，互不串台", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel({
      folders: [
        { id: "ext-1", path: "D:\\资料\\工作", name: "工作" },
        { id: "ext-2", path: "D:\\资料\\私人", name: "私人" },
      ],
      trees: { "ext-1": TREE, "ext-2": TREE },
    });

    await expandTree(user);
    // 在第一棵树里把「归档」设为新建位置
    await user.click(rowOf("归档"));
    fireEvent.contextMenu(scrollAreaOf(0), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    expect(props.onCreateFolder).toHaveBeenCalledTimes(1);
    const [folder, target] = props.onCreateFolder.mock.calls[0] as unknown as [
      ExternalFolder,
      string
    ];
    expect(folder.id).toBe("ext-1");
    expect(target).toBe("归档");

    // 第二棵树是另一个位置：它的新建位置还停在根上
    await user.click(screen.getByText("私人"));
    fireEvent.contextMenu(scrollAreaOf(1), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    expect(props.onCreateFolder).toHaveBeenCalledTimes(2);
    const [folder2, target2] = props.onCreateFolder.mock.calls[1] as unknown as [
      ExternalFolder,
      string
    ];
    expect(folder2.id).toBe("ext-2");
    expect(target2).toBe("");
  });

  it("不再有「新建位置」那一行 —— 落点由右键菜单自己说", async () => {
    const user = userEvent.setup();
    renderPanel();

    await expandTree(user);

    expect(screen.queryByText(/新建位置/)).toBeNull();
  });

  it("选了子文件夹也不说「新建位置」—— 菜单标题里写着落点", async () => {
    const user = userEvent.setup();
    renderPanel();

    await expandTree(user);
    await user.click(rowOf("归档"));

    expect(screen.queryByText(/新建位置/)).toBeNull();

    // 落点改由右键菜单的标题说明
    fireEvent.contextMenu(rowOf("归档"), { clientX: 100, clientY: 200 });
    expect(screen.getByText("在「归档」下新建")).toBeTruthy();
  });
});
