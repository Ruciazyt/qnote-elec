import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDevRoot } from "../../utils/paths";
import {
  contentHash,
  detectNoteType,
  getNoteTypeMeta,
  isFolderNode,
  isNoteFile,
  nativeStatus,
  stripExt,
  withDefaultExt,
} from "./nativeNotes";
import { contentHash as tsContentHash } from "../../../shared/notes/noteHash";
import {
  detectNoteType as tsDetectNoteType,
  getNoteTypeMeta as tsGetNoteTypeMeta,
  isFolderNode as tsIsFolderNode,
  isNoteFile as tsIsNoteFile,
  stripExt as tsStripExt,
  withDefaultExt as tsWithDefaultExt,
} from "../../../shared/notes/noteTypes";

const nativeBuilt = fs.existsSync(path.join(getDevRoot(), "dist", "native", "notes-rs.cjs"));

describe("Rust 原生模块接线", () => {
  it("原生模块在时走 Rust 实现", () => {
    const status = nativeStatus();
    expect(status.loaded).toBe(nativeBuilt);
  });

  it("哈希与 TypeScript 实现一致", () => {
    for (const content of ["", "同一条内容", "内容 A", "emoji 👍🏽 mix", "a".repeat(5000)]) {
      expect(contentHash(content)).toBe(tsContentHash(content));
    }
  });

  it("扩展名与类型判定一致", () => {
    for (const name of ["a.md", "a.MD", "a.tar.gz", "a", ".hidden", "图片.PNG", "x.markdown"]) {
      expect(detectNoteType(name)).toBe(tsDetectNoteType(name));
      expect(isNoteFile(name)).toBe(tsIsNoteFile(name));
      expect(stripExt(name)).toBe(tsStripExt(name));
    }
  });

  it("类型元信息一致", () => {
    for (const type of ["markdown", "excalidraw", "html", "image", "pdf"] as const) {
      expect(getNoteTypeMeta(type)).toEqual(tsGetNoteTypeMeta(type));
    }
  });

  it("补默认扩展名一致", () => {
    expect(withDefaultExt("note", "markdown")).toBe(tsWithDefaultExt("note", "markdown"));
    expect(withDefaultExt("note.md", "markdown")).toBe(tsWithDefaultExt("note.md", "markdown"));
    expect(withDefaultExt("   ", "markdown")).toBe(tsWithDefaultExt("   ", "markdown"));
  });

  it("树节点判定一致，空值同样抛错", () => {
    const folder = { kind: "folder", name: "a", relPath: "a", path: "a", childCount: 0, children: [] };
    const file = { kind: "file", name: "a.md", relPath: "a.md", path: "a.md", type: "markdown", ext: ".md", size: 1, mtime: 0 };
    expect(isFolderNode(folder as never)).toBe(tsIsFolderNode(folder as never));
    expect(isFolderNode(file as never)).toBe(tsIsFolderNode(file as never));
    expect(() => isFolderNode(null as never)).toThrow();
    expect(() => tsIsFolderNode(null as never)).toThrow();
  });
});
