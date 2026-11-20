import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

function ControlledPanel(props: {
  currentFolder?: string;
  createTargetFolder?: string;
  onPickFolder: (relPath: string) => void;
}) {
  const [currentFolder, setCurrentFolder] = useState(props.currentFolder ?? "");
  return (
    <NoteFileList
      nodes={[FOLDER]}
      childrenMap={{ 工作: [CHILD] }}
      activeRelPath={null}
      currentFolder={currentFolder}
      createTargetFolder={props.createTargetFolder ?? ""}
      renamingRel={null}
      renameValue=""
      renaming={false}
      onOpen={vi.fn()}
      onPickFolder={(rel) => {
        setCurrentFolder(rel);
        props.onPickFolder(rel);
      }}
      onDelete={vi.fn()}
      onRenameStart={vi.fn()}
      onRenameChange={vi.fn()}
      onRenameConfirm={vi.fn()}
      onRenameCancel={vi.fn()}
      onCreateFolder={vi.fn()}
      onMove={vi.fn()}
    />
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("[role='button']") as HTMLElement;
}

describe("文件夹行的展开与落点", () => {
  it("点折叠的行 → 展开，并把该目录设为落点", async () => {
    const user = userEvent.setup();
    const onPickFolder = vi.fn();
    render(<ControlledPanel onPickFolder={onPickFolder} />);

    expect(screen.queryByText("计划")).toBeNull();

    await user.click(rowOf("工作"));

    expect(screen.getByText("计划")).toBeTruthy();
    expect(onPickFolder).toHaveBeenCalledWith("工作");
  });

  it("点已展开的行 → 收起，并取消落点", async () => {
    const user = userEvent.setup();
    const onPickFolder = vi.fn();
    render(<ControlledPanel currentFolder="工作" onPickFolder={onPickFolder} />);

    expect(screen.getByText("计划")).toBeTruthy();

    await user.click(rowOf("工作"));

    expect(screen.queryByText("计划")).toBeNull();
    expect(onPickFolder).toHaveBeenCalledWith("");
  });

  it("点已展开但不是落点的行 → 只收起，落点不动", async () => {
    const user = userEvent.setup();
    const onPickFolder = vi.fn();
    render(
      <ControlledPanel currentFolder="" createTargetFolder="工作" onPickFolder={onPickFolder} />
    );

    expect(screen.getByText("计划")).toBeTruthy();

    await user.click(rowOf("工作"));

    expect(screen.queryByText("计划")).toBeNull();
    expect(onPickFolder).not.toHaveBeenCalled();
  });

  it("行标题不再说「再点一次取消」，改成说明展开与收起", async () => {
    const user = userEvent.setup();
    render(<ControlledPanel onPickFolder={vi.fn()} />);

    expect(rowOf("工作").getAttribute("title")).toContain("点击展开");

    await user.click(rowOf("工作"));

    expect(rowOf("工作").getAttribute("title")).toContain("点击收起");
  });
});
