import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../test/electron-stub";
import type { ExternalFolder, NoteTreeNode } from "../../shared/noteTypes";

/**
 * 笔记页与「外部文件夹」的接线
 *
 * 组件自身的渲染在 NoteExternalFolders.test.tsx 里锁了；这里锁的是**接线**：
 *
 * 1. 侧栏下半部分确实挂了这块区域，且默认收起（不挤主树）
 * 2. 展开外部文件夹 → 读它的树 → 文件出现在列表里
 * 3. 点外部文件 → 当前打开的笔记换成它，且「在文件管理器中打开」
 *    走的是外部通道（带 id），不会去动笔记根目录
 *
 * 第 3 条是最容易出错的地方：同一个 relPath 在笔记根目录和外部文件夹下
 * 可能指向两个文件，只按路径定位就会开错。
 */

vi.mock("@/components/Note/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});

const FOLDER: ExternalFolder = {
  id: "ext-1",
  path: "D:\\资料\\工作",
  name: "工作",
};

const EXT_TREE: NoteTreeNode[] = [
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

async function renderNotesPage(electron: Record<string, unknown>) {
  window.electron = createElectronStub({
    getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
    getNoteTree: vi.fn().mockResolvedValue([]),
    getExternalFolders: vi.fn().mockResolvedValue([FOLDER]),
    getExternalTree: vi.fn().mockResolvedValue(EXT_TREE),
    onNotesChanged: vi.fn(() => () => {}),
    ...electron,
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

describe("笔记页的外部文件夹区域", () => {
  beforeEach(() => {
    // 侧栏默认是收起的 —— 收着的时候连路径行都不挂，外部区域自然也没有
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    // 分栏比例要回到默认值（6:4），否则上一条用例拖过的值会串台
    window.localStorage.removeItem("notes-sidebar-split-ratio");
  });

  it("侧栏下半部分有这一块，且默认收起", async () => {
    await renderNotesPage({});

    expect(screen.getByText("外部文件夹")).toBeTruthy();
    // 收起状态下看不到已登记的文件夹名
    expect(screen.queryByText("工作")).toBeNull();
  });

  it("展开外部文件夹 → 读树 → 文件列出来", async () => {
    const user = userEvent.setup();
    const getExternalTree = vi.fn().mockResolvedValue(EXT_TREE);
    await renderNotesPage({ getExternalTree });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));

    await waitFor(() => expect(getExternalTree).toHaveBeenCalledWith("ext-1"));
    await waitFor(() => expect(screen.getByText("会议纪要")).toBeTruthy());
  });

  it("点外部文件后，「在文件管理器中打开」走外部通道", async () => {
    const user = userEvent.setup();
    const revealExternalFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ revealExternalFile });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));
    await waitFor(() => expect(screen.getByText("会议纪要")).toBeTruthy());
    await user.click(screen.getByText("会议纪要"));

    // 打开的是外部文件夹里的那个文件 → 定位时必须带上文件夹 id
    await user.click(screen.getByRole("button", { name: "在文件管理器中打开" }));

    await waitFor(() =>
      expect(revealExternalFile).toHaveBeenCalledWith("ext-1", "会议纪要.md")
    );
  });

  it("移除外部文件夹只改清单，磁盘文件不动", async () => {
    const user = userEvent.setup();
    const removeExternalFolder = vi.fn().mockResolvedValue([]);
    await renderNotesPage({ removeExternalFolder });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByRole("button", { name: "移除 工作" }));

    await waitFor(() => expect(removeExternalFolder).toHaveBeenCalledWith("ext-1"));
  });
});

/**
 * 主树与外部文件夹的上下分栏
 *
 * 默认 6:4，中间那条分割线可拖，拖完的比例记在 localStorage。
 * 收起外部区时分割线禁用（下块只剩标题行，没有可调的高度），
 * 主树把空出来的高度全拿走。
 */
describe("笔记侧栏的上下分栏", () => {
  beforeEach(() => {
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    window.localStorage.setItem("notes-external-folders-collapsed", "true");
    window.localStorage.removeItem("notes-sidebar-split-ratio");
  });

  /** 某一块的容器 */
  function areaOf(kind: "tree" | "external"): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-notes-split="${kind}"]`);
    if (!el) throw new Error(`没有找到 ${kind} 那块`);
    return el;
  }

  it("默认 6:4 —— 外部区占 4 份，笔记树占 6 份", async () => {
    await renderNotesPage({});

    expect(areaOf("external").dataset.splitRatio).toBe("0.4");
    expect(areaOf("tree").dataset.splitRatio).toBe("0.4");
  });

  it("分割线可以拖（这里是键盘），比例跟着变并记住", async () => {
    const user = userEvent.setup();
    await renderNotesPage({});

    // 收起状态下分割线是禁用的：下块没有可调的高度
    const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
    expect(slider).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    expect(slider).not.toHaveAttribute("aria-disabled");
    expect(slider).toHaveAttribute("aria-valuenow", "40");

    slider.focus();
    await user.keyboard("{ArrowUp}");
    // 向上 = 分割线上移 = 下块（外部区）变高 → 比例变大
    expect(slider).toHaveAttribute("aria-valuenow", "42");
    expect(Number(areaOf("external").dataset.splitRatio)).toBeCloseTo(0.42, 5);

    // 比例写进了 localStorage —— 下次打开还是这个
    expect(Number(window.localStorage.getItem("notes-sidebar-split-ratio"))).toBeCloseTo(
      0.42,
      5
    );
  });

  it("双击分割线回到默认比例", async () => {
    const user = userEvent.setup();
    await renderNotesPage({});

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
    slider.focus();
    await user.keyboard("{ArrowUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "42");

    await user.dblClick(slider);
    expect(slider).toHaveAttribute("aria-valuenow", "40");
  });
});

/**
 * 外部文件夹的文件管理（增删改）
 *
 * 外部区的树是主树那套 NoteFileList，主进程那边也分了两条通道：
 * 笔记根目录走 filePath，外部文件夹走 id。
 * 这批用例盯的就是**分流**：
 * 在外部树上做的增删改必须带上外部文件夹的 id，绝不能落到笔记根目录去。
 *
 * 写错的后果不是「不生效」，而是删掉笔记根目录下的同名文件 —— 不可逆。
 */

/** 文件树里那一行（行本身是 role="button" 的 div） */
function rowOf(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("[role='button']") as HTMLElement;
}

/**
 * 外部那棵树的滚动区 —— 空白处的右键落在这里
 *
 * 笔记根目录的树也在页面上，但只有外部树里有「会议纪要」这一行，
 * 顺着它往上找就能定位到外部树，不会认错到主树上。
 */
function externalScrollArea(): HTMLElement {
  return rowOf("会议纪要").closest("[data-note-tree-scroll]") as HTMLElement;
}

/**
 * 造一个假的 DataTransfer
 *
 * jsdom 没有实现 DataTransfer，fireEvent.dragStart 不带这个对象的话，
 * 处理函数里的 e.dataTransfer.setData 会直接抛错。
 */
function mockDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? "",
    effectAllowed: "move",
    dropEffect: "move",
    types: [] as string[],
    files: [] as unknown[],
    items: [] as unknown[],
  };
}

/** 展开外部文件夹区并展开其中那个「工作」，等树渲染出来 */
async function openExternalTree(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
  await user.click(screen.getByText("工作"));
  await waitFor(() => expect(screen.getByText("会议纪要")).toBeTruthy());
}

describe("外部文件夹的增删改（接线）", () => {
  beforeEach(() => {
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    window.localStorage.setItem("notes-external-folders-collapsed", "true");
  });

  it("删除外部文件 → 确认框 → 走 deleteExternalFile", async () => {
    const user = userEvent.setup();
    const deleteExternalFile = vi.fn().mockResolvedValue(true);
    const deleteExternalFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ deleteExternalFile, deleteExternalFolder });

    await openExternalTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "删除 会议纪要.md" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确定删除" }));

    await waitFor(() =>
      expect(deleteExternalFile).toHaveBeenCalledWith("ext-1", "会议纪要.md")
    );
    expect(deleteExternalFolder).not.toHaveBeenCalled();
  });

  it("删除外部文件夹 → 确认框 → 走 deleteExternalFolder", async () => {
    const user = userEvent.setup();
    const deleteExternalFile = vi.fn().mockResolvedValue(true);
    const deleteExternalFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ deleteExternalFile, deleteExternalFolder });

    await openExternalTree(user);
    await user.hover(rowOf("归档"));
    fireEvent.click(screen.getByRole("button", { name: "删除 归档" }));
    await user.click(screen.getByRole("button", { name: "确定删除" }));

    await waitFor(() => expect(deleteExternalFolder).toHaveBeenCalledWith("ext-1", "归档"));
    expect(deleteExternalFile).not.toHaveBeenCalled();
  });

  it("确认框说清删的是哪个外部文件夹里的东西", async () => {
    const user = userEvent.setup();
    await renderNotesPage({});

    await openExternalTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "删除 会议纪要.md" }));

    const dialog = screen.getByRole("dialog");
    // 标题只有动作 + 类别，目标名放在正文里
    expect(dialog).toHaveAccessibleName("删除笔记");

    const id = dialog.getAttribute("aria-describedby");
    const description = document.getElementById(id!) as HTMLElement;
    expect(description.textContent).toContain("「会议纪要.md」");
    expect(description.textContent).toContain("外部文件夹");
    expect(description.textContent).toContain("工作");
    // 磁盘上的文件删了就没了，要单独说一句
    expect(description.textContent).toContain("无法恢复");
  });

  it("重命名 → 走 renameExternalEntry，补回扩展名", async () => {
    const user = userEvent.setup();
    const renameExternalEntry = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ renameExternalEntry });

    await openExternalTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "重命名 会议纪要.md" }));

    const input = document.querySelector("[data-rename-input]") as HTMLInputElement;
    expect(input.value).toBe("会议纪要");
    await user.clear(input);
    await user.type(input, "新纪要");
    await user.keyboard("{Enter}");

    // 输入框里不带扩展名，扩展名由类型决定 —— 落盘时要补回去
    await waitFor(() =>
      expect(renameExternalEntry).toHaveBeenCalledWith("ext-1", "会议纪要.md", "新纪要.md")
    );
  });

  it("新建文件夹 → 走 createExternalFolder，落点是外部文件夹", async () => {
    const user = userEvent.setup();
    const createExternalFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ createExternalFolder });

    await openExternalTree(user);
    // 新建只在右键菜单里，工具栏那排图标按钮已经撤掉
    fireEvent.contextMenu(externalScrollArea(), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    // 命名框要写明是哪个外部文件夹 —— 否则用户不知道建到哪了
    expect(screen.getByText(/外部文件夹「工作」/)).toBeTruthy();

    const input = screen.getByPlaceholderText("文件夹名称");
    await user.clear(input);
    await user.type(input, "新文件夹");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(createExternalFolder).toHaveBeenCalledWith("ext-1", "", "新文件夹")
    );
  });

  it("新建笔记 → 走 createExternalFile", async () => {
    const user = userEvent.setup();
    const createExternalFile = vi
      .fn()
      .mockResolvedValue({ ok: true, relPath: "新笔记.md" });
    await renderNotesPage({ createExternalFile });

    await openExternalTree(user);
    fireEvent.contextMenu(externalScrollArea(), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件" }));
    await user.click(screen.getByRole("menuitem", { name: /^文本/ }));

    expect(screen.getByText(/外部文件夹「工作」/)).toBeTruthy();

    const input = screen.getByPlaceholderText("请输入文件名（无需后缀）");
    await user.clear(input);
    await user.type(input, "新笔记");
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(createExternalFile).toHaveBeenCalledWith("ext-1", "", "新笔记", "markdown")
    );
  });

  it("拖到子文件夹 → 走 moveExternalEntry", async () => {
    const user = userEvent.setup();
    const moveExternalEntry = vi.fn().mockResolvedValue({ ok: true });
    await renderNotesPage({ moveExternalEntry });

    await openExternalTree(user);

    const dataTransfer = mockDataTransfer();
    fireEvent.dragStart(rowOf("会议纪要"), { dataTransfer });
    fireEvent.dragOver(rowOf("归档"), { dataTransfer });
    fireEvent.drop(rowOf("归档"), { dataTransfer });

    await waitFor(() =>
      expect(moveExternalEntry).toHaveBeenCalledWith("ext-1", "会议纪要.md", "归档")
    );
  });

  /**
   * 回归：外部删到一半放弃，不能把外部的 id 漏进下一次主树删除
   *
   * 早先「待删条目」和「属于哪个外部文件夹」是两个独立的 state，
   * 关弹窗时只清了条目、没清 id。下一次在主树里删文件，
   * 残留的 id 会把删除导向外部根 —— 删掉的是外部里的同名文件，
   * 主树里那个反而还在。
   */
  it("外部删除中途放弃后，主树删除仍走主树通道", async () => {
    const user = userEvent.setup();
    const deleteExternalFile = vi.fn().mockResolvedValue(true);
    const deleteNoteFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({
      deleteExternalFile,
      deleteNoteFile,
      // 主树里也放一个同名文件 —— 串台时它会是被误删的那个
      getNoteTree: vi.fn().mockResolvedValue([
        {
          kind: "file",
          name: "读书笔记.md",
          relPath: "读书笔记.md",
          path: "D:\\notes\\读书笔记.md",
          type: "markdown",
          ext: ".md",
          size: 64,
          mtime: 1700000000,
        },
      ]),
    });

    // 先在外部区点删除，然后放弃
    await openExternalTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "删除 会议纪要.md" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // 再在主树里删一个文件
    await user.hover(rowOf("读书笔记"));
    fireEvent.click(screen.getByRole("button", { name: "删除 读书笔记.md" }));
    await user.click(screen.getByRole("button", { name: "确定删除" }));

    await waitFor(() =>
      expect(deleteNoteFile).toHaveBeenCalledWith("D:\\notes", "读书笔记.md")
    );
    expect(deleteExternalFile).not.toHaveBeenCalled();
  });
});
