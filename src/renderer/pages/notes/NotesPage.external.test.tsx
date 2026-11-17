import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../../test/electron-stub";
import type { ExternalFolder, NoteTreeNode } from "../../../shared/notes/noteTypes";


vi.mock("@/pages/notes/editors/ExcalidrawEditor", async () => {
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
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    window.localStorage.removeItem("notes-sidebar-split-ratio");
  });

  it("侧栏下半部分有这一块，且默认收起", async () => {
    await renderNotesPage({});

    expect(screen.getByText("外部文件夹")).toBeTruthy();
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

    await user.click(screen.getByRole("button", { name: "在文件管理器中打开" }));

    await waitFor(() =>
      expect(revealExternalFile).toHaveBeenCalledWith("ext-1", "会议纪要.md", "reveal")
    );
  });

  it("右键外部文件 → 「在文件夹中显示」定位到它所在的目录", async () => {
    const user = userEvent.setup();
    const revealExternalFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ revealExternalFile });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));
    await waitFor(() => expect(screen.getByText("会议纪要")).toBeTruthy());

    const row = screen.getByText("会议纪要").closest("[role='button']") as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 200 });
    await user.click(screen.getByRole("menuitem", { name: "在文件夹中显示" }));

    await waitFor(() =>
      expect(revealExternalFile).toHaveBeenCalledWith("ext-1", "会议纪要.md", "reveal")
    );
  });

  it("右键外部文件夹 → 「在文件管理器中打开」打开那个目录本身", async () => {
    const user = userEvent.setup();
    const revealExternalFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ revealExternalFile });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByText("工作"));
    await waitFor(() => expect(screen.getByText("归档")).toBeTruthy());

    const row = screen.getByText("归档").closest("[role='button']") as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 200 });
    await user.click(screen.getByRole("menuitem", { name: "在文件管理器中打开" }));

    await waitFor(() =>
      expect(revealExternalFile).toHaveBeenCalledWith("ext-1", "归档", "open")
    );
  });

  it("外部文件夹行的按钮打开它自己的目录", async () => {
    const user = userEvent.setup();
    const revealExternalFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ revealExternalFile });

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    await user.click(screen.getByRole("button", { name: "在文件管理器中打开 工作" }));

    await waitFor(() =>
      expect(revealExternalFile).toHaveBeenCalledWith("ext-1", "", "open")
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

describe("笔记侧栏的上下分栏", () => {
  beforeEach(() => {
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    window.localStorage.setItem("notes-external-folders-collapsed", "true");
    window.localStorage.removeItem("notes-sidebar-split-ratio");
  });

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

    const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
    expect(slider).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "展开外部文件夹" }));
    expect(slider).not.toHaveAttribute("aria-disabled");
    expect(slider).toHaveAttribute("aria-valuenow", "40");

    slider.focus();
    await user.keyboard("{ArrowUp}");
    expect(slider).toHaveAttribute("aria-valuenow", "42");
    expect(Number(areaOf("external").dataset.splitRatio)).toBeCloseTo(0.42, 5);

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


function rowOf(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("[role='button']") as HTMLElement;
}

function externalScrollArea(): HTMLElement {
  return rowOf("会议纪要").closest("[data-note-tree-scroll]") as HTMLElement;
}

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
    expect(dialog).toHaveAccessibleName("删除笔记");

    const id = dialog.getAttribute("aria-describedby");
    const description = document.getElementById(id!) as HTMLElement;
    expect(description.textContent).toContain("「会议纪要.md」");
    expect(description.textContent).toContain("外部文件夹");
    expect(description.textContent).toContain("工作");
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

    await waitFor(() =>
      expect(renameExternalEntry).toHaveBeenCalledWith("ext-1", "会议纪要.md", "新纪要.md")
    );
  });

  it("新建文件夹 → 走 createExternalFolder，落点是外部文件夹", async () => {
    const user = userEvent.setup();
    const createExternalFolder = vi.fn().mockResolvedValue(true);
    await renderNotesPage({ createExternalFolder });

    await openExternalTree(user);
    fireEvent.contextMenu(externalScrollArea(), { clientX: 60, clientY: 300 });
    await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

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

  it("外部删除中途放弃后，主树删除仍走主树通道", async () => {
    const user = userEvent.setup();
    const deleteExternalFile = vi.fn().mockResolvedValue(true);
    const deleteNoteFile = vi.fn().mockResolvedValue(true);
    await renderNotesPage({
      deleteExternalFile,
      deleteNoteFile,
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

    await openExternalTree(user);
    await user.hover(rowOf("会议纪要"));
    fireEvent.click(screen.getByRole("button", { name: "删除 会议纪要.md" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.hover(rowOf("读书笔记"));
    fireEvent.click(screen.getByRole("button", { name: "删除 读书笔记.md" }));
    await user.click(screen.getByRole("button", { name: "确定删除" }));

    await waitFor(() =>
      expect(deleteNoteFile).toHaveBeenCalledWith("D:\\notes", "读书笔记.md")
    );
    expect(deleteExternalFile).not.toHaveBeenCalled();
  });
});
