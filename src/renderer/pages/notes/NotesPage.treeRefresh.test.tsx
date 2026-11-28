import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../../test/electron-stub";
import { publishRoutePath } from "@/hooks/system/routeStore";
import type { NoteTreeNode } from "@shared/notes/noteTypes";

vi.mock("@/pages/notes/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});

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

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("[role='button']") as HTMLElement;
}

describe("刷新笔记树时不动已打开的子目录笔记", () => {
  beforeEach(() => {
    publishRoutePath("/notes");
    window.localStorage.setItem("notes-sidebar-collapsed", "false");
  });

  it("收到 notes:changed 后不重读磁盘，未保存的改动不会被覆盖", async () => {
    const user = userEvent.setup();
    const childrenSpy = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return [CHILD];
    });
    const readSpy = vi.fn().mockResolvedValue("计划正文");
    let onChanged: ((root: string) => void) | null = null;

    window.electron = createElectronStub({
      getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
      getNoteTree: vi.fn().mockResolvedValue([FOLDER]),
      getNoteTreeChildren: childrenSpy,
      readMarkdownNote: readSpy,
      onNotesChanged: vi.fn((cb: (root: string) => void) => {
        onChanged = cb;
        return () => {};
      }),
    });

    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <NotesPage />
      </MemoryRouter>
    );

    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });

    await user.click(rowOf("工作"));
    await waitFor(() => expect(screen.getByText("计划")).toBeTruthy());
    expect(childrenSpy).toHaveBeenCalledWith("D:\\notes", "工作");

    await user.click(rowOf("计划"));
    await waitFor(() => expect(screen.getByText("计划正文")).toBeTruthy());
    expect(readSpy).toHaveBeenCalledTimes(1);

    const fetchCountBefore = childrenSpy.mock.calls.length;
    await act(async () => {
      onChanged?.("D:\\notes");
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(childrenSpy.mock.calls.length).toBeGreaterThan(fetchCountBefore);
    expect(screen.getByText("计划")).toBeTruthy();
    expect(screen.getByText("计划正文")).toBeTruthy();
    expect(readSpy).toHaveBeenCalledTimes(1);
  });
});
