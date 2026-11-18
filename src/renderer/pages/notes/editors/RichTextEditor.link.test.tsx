import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import RichTextEditor from "./RichTextEditor";
import type { NoteFileEntry } from "../../../../shared/notes/noteTypes";

const MARKDOWN = [
  "# 目标标题",
  "",
  "[跳到标题](#目标标题)",
  "",
  "[外部链接](https://example.com/docs)",
  "",
].join("\n");

const file: NoteFileEntry = {
  name: "note.md",
  relPath: "note.md",
  path: "/notes/note.md",
  type: "markdown",
  ext: ".md",
  size: MARKDOWN.length,
  mtime: 0,
};

function setup() {
  const openExternal = vi.fn().mockResolvedValue(true);
  const readMarkdownNote = vi.fn().mockResolvedValue(MARKDOWN);
  window.electron = createElectronStub({ openExternal, readMarkdownNote });
  render(
    <RichTextEditor
      file={file}
      dirPath="/notes"
      onSaved={() => {}}
      onRequestSaveAs={() => {}}
    />
  );
  return { openExternal };
}

describe("笔记里的链接点击", () => {
  it("点外链走系统浏览器", async () => {
    const user = userEvent.setup();
    const { openExternal } = setup();

    const link = await screen.findByRole("link", { name: "外部链接" });
    await user.click(link);

    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("点同文件锚点跳到对应标题，不走外链", async () => {
    const user = userEvent.setup();
    const { openExternal } = setup();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

    const link = await screen.findByRole("link", { name: "跳到标题" });
    await user.click(link);

    expect(openExternal).not.toHaveBeenCalled();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect((scroll.mock.instances[0] as HTMLElement).tagName).toBe("H1");
  });
});
