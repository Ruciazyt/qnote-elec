import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoteFileList from "./NoteFileList";
import type { NoteTreeNode } from "@shared/notes/noteTypes";

const FOLDER: NoteTreeNode = {
  kind: "folder",
  name: "工作",
  relPath: "工作",
  children: [],
};

const CHILD: NoteTreeNode = {
  kind: "file",
  name: "计划.md",
  relPath: "工作/计划.md",
  path: "D:\\notes\\工作\\计划.md",
  type: "markdown",
  ext: ".md",
  size: 64,
  mtime: 1700000000,
};

function renderList(
  overrides: Partial<React.ComponentProps<typeof NoteFileList>> = {}
) {
  const props = {
    nodes: [FOLDER],
    activeRelPath: null,
    currentFolder: "",
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
    onMove: vi.fn(),
    ...overrides,
  };
  const utils = render(<NoteFileList {...props} />);
  return { ...utils, props };
}

describe("目录树按需加载", () => {
  it("不展开就不去读子目录", async () => {
    const onLoadChildren = vi.fn();
    renderList({ onLoadChildren });

    expect(onLoadChildren).not.toHaveBeenCalled();
  });

  it("展开文件夹才去读那一层", async () => {
    const user = userEvent.setup();
    const onLoadChildren = vi.fn();
    renderList({ onLoadChildren });

    await user.click(screen.getByRole("button", { name: "展开" }));

    expect(onLoadChildren).toHaveBeenCalledWith("工作");
  });

  it("读到之后把子节点渲染出来", async () => {
    const user = userEvent.setup();
    const { rerender } = renderList({ onLoadChildren: vi.fn() });

    await user.click(screen.getByRole("button", { name: "展开" }));

    rerender(
      <NoteFileList
        nodes={[FOLDER]}
        childrenMap={{ 工作: [CHILD] }}
        onLoadChildren={vi.fn()}
        activeRelPath={null}
        currentFolder=""
        renamingRel={null}
        renameValue=""
        renaming={false}
        onOpen={vi.fn()}
        onPickFolder={vi.fn()}
        onDelete={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameChange={vi.fn()}
        onRenameConfirm={vi.fn()}
        onRenameCancel={vi.fn()}
        onCreateFolder={vi.fn()}
        onMove={vi.fn()}
      />
    );

    expect(screen.getByText("计划")).toBeTruthy();
  });

  it("子节点读回来之前显示读取中，而不是空目录", async () => {
    const user = userEvent.setup();
    renderList({ onLoadChildren: vi.fn() });

    await user.click(screen.getByRole("button", { name: "展开" }));

    expect(screen.getByText("正在读取…")).toBeTruthy();
  });

  it("没给加载回调时退回用节点自带的子节点", async () => {
    const user = userEvent.setup();
    renderList({
      nodes: [{ ...FOLDER, children: [CHILD] }],
    });

    await user.click(screen.getByRole("button", { name: "展开" }));

    expect(screen.getByText("计划")).toBeTruthy();
  });
});
