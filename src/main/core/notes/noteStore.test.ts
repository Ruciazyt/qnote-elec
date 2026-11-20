import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("../system/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NoteStore } from "./noteStore";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "qnote-notes-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = "x"): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

describe("NoteStore.listChildren", () => {
  it("只读一层 —— 子目录里的文件不会混进来", async () => {
    write("顶层.md");
    write("子目录/深层.md");

    const nodes = await new NoteStore().listChildren(root, "");

    expect(nodes.map((n) => n.relPath).sort()).toEqual(["子目录", "顶层.md"]);
    const folder = nodes.find((n) => n.kind === "folder");
    expect(folder?.children).toEqual([]);
  });

  it("非笔记文件不进树，根层的 assets 目录被跳过", async () => {
    write("笔记.md");
    write("说明.txt");
    write("程序.exe");
    write(".隐藏.md");
    write("assets/图.png");

    const nodes = await new NoteStore().listChildren(root, "");

    expect(nodes.map((n) => n.relPath)).toEqual(["笔记.md"]);
  });

  it("目录在前按名称排序，文件按修改时间倒序", async () => {
    write("b目录/keep.md");
    write("a目录/keep.md");
    write("旧.md");
    write("新.md");
    fs.utimesSync(path.join(root, "旧.md"), new Date(1000), new Date(1000));
    fs.utimesSync(path.join(root, "新.md"), new Date(2000), new Date(2000));

    const nodes = await new NoteStore().listChildren(root, "");

    expect(nodes.map((n) => n.relPath)).toEqual(["a目录", "b目录", "新.md", "旧.md"]);
  });

  it("单层条目数有上限，不会把一层几千个文件全端上来", async () => {
    for (let i = 0; i < 12; i += 1) write(`笔记${i}.md`);

    const nodes = await new NoteStore().listChildren(root, "", 5);

    expect(nodes).toHaveLength(5);
  });

  it("路径越界直接拒绝，不去读目录外的东西", async () => {
    const nodes = await new NoteStore().listChildren(root, "../..");

    expect(nodes).toEqual([]);
  });

  it("目录不存在时返回空列表而不是抛错", async () => {
    const nodes = await new NoteStore().listChildren(root, "根本没有这个目录");

    expect(nodes).toEqual([]);
  });
});

describe("NoteStore.scanFiles", () => {
  it("递归找笔记，但受目录预算约束", async () => {
    write("a/1.md");
    write("b/2.md");
    write("c/3.md");

    const files = await new NoteStore().scanFiles(root, {
      maxDirs: 2,
      maxFiles: 100,
      deadlineMs: 5000,
    });

    expect(files.length).toBeLessThanOrEqual(2);
  });

  it("文件数用满就停", async () => {
    write("a/1.md");
    write("b/2.md");

    const files = await new NoteStore().scanFiles(root, {
      maxDirs: 50,
      maxFiles: 1,
      deadlineMs: 5000,
    });

    expect(files.length).toBeLessThanOrEqual(1);
  });

  it("只看得到笔记文件", async () => {
    write("甲.md");
    write("乙.txt");

    const files = await new NoteStore().scanFiles(root, {
      maxDirs: 50,
      maxFiles: 100,
      deadlineMs: 5000,
    });

    expect(files.map((n) => n.relPath)).toEqual(["甲.md"]);
  });
});

describe("NoteStore.countByType", () => {
  it("按类型计数，非笔记文件不计入", async () => {
    write("一.md");
    write("二.md");
    write("三.html");
    write("图.png");
    write("不是笔记.txt");

    const counts = await new NoteStore().countByType(root);

    expect(counts.markdown).toBe(2);
    expect(counts.html).toBe(1);
    expect(counts.image).toBe(1);
    expect(counts.pdf).toBe(0);
    expect(counts.excalidraw).toBe(0);
  });
});
