import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../../test/electron-stub";
import type { NoteTreeNode } from "../../../shared/notes/noteTypes";


const counters = vi.hoisted(() => ({
  byType: new Map<string, number>(),
}));

vi.mock("../../../shared/notes/noteTypes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/notes/noteTypes")>();
  return {
    ...actual,
    getNoteTypeMeta: (type: string) => {
      counters.byType.set(type, (counters.byType.get(type) ?? 0) + 1);
      return actual.getNoteTypeMeta(type as Parameters<typeof actual.getNoteTypeMeta>[0]);
    },
  };
});

vi.mock("@/pages/notes/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});

const TREE_TYPE = "pdf";

const BIG_TREE: NoteTreeNode[] = Array.from({ length: 200 }, (_, i) => ({
  kind: "file" as const,
  name: `笔记-${i}.md`,
  relPath: `笔记-${i}.md`,
  path: `D:\\notes\\笔记-${i}.md`,
  type: TREE_TYPE,
  ext: ".pdf",
  size: 128,
  mtime: 1700000000000,
}));

function treeRowRenders(): number {
  return counters.byType.get(TREE_TYPE) ?? 0;
}

function pointerEvent(type: string, clientX: number, clientY = 0): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
}

function pointerDown(el: Element, clientX: number, clientY = 0) {
  act(() => {
    el.dispatchEvent(pointerEvent("pointerdown", clientX, clientY));
  });
}

function pointerMove(clientX: number, clientY = 0) {
  act(() => {
    window.dispatchEvent(pointerEvent("pointermove", clientX, clientY));
  });
}

function pointerUp(clientX: number, clientY = 0) {
  act(() => {
    window.dispatchEvent(pointerEvent("pointerup", clientX, clientY));
  });
}

async function nextFrame() {
  await act(async () => {
    vi.advanceTimersByTime(16);
  });
}

function areaOf(kind: "tree" | "external"): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-notes-split="${kind}"]`);
  if (!el) throw new Error(`没有找到 ${kind} 那块`);
  return el;
}

function sidebar(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-notes-sidebar]");
  if (!el) throw new Error("没有找到侧栏");
  return el;
}

const FAKE_BOX = {
  width: 300,
  height: 400,
  top: 0,
  left: 0,
  right: 300,
  bottom: 400,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

async function renderNotesPage() {
  window.electron = createElectronStub({
    getFilePath: vi.fn().mockResolvedValue("D:\\notes"),
    getNoteTree: vi.fn().mockResolvedValue(BIG_TREE),
    getExternalFolders: vi.fn().mockResolvedValue([]),
    getExternalTree: vi.fn().mockResolvedValue([]),
    onNotesChanged: vi.fn(() => () => {}),
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

function spyOnStorageWrites() {
  const calls: string[] = [];
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string
  ) {
    calls.push(key);
    original.call(this, key, value);
  });
  return { calls };
}

describe("笔记页分割线拖拽的流畅度", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(FAKE_BOX);

    window.localStorage.setItem("notes-sidebar-collapsed", "false");
    window.localStorage.setItem("notes-external-folders-collapsed", "false");
    window.localStorage.removeItem("notes-sidebar-split-ratio");
    counters.byType.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("上下分割线（笔记树 | 外部文件夹）", () => {
    it("拖拽期间目录树不重建 —— 每一帧重渲染几百行是卡顿的主因", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
      const before = treeRowRenders();

      pointerDown(slider, 300, 200);
      for (let i = 1; i <= 30; i += 1) {
        pointerMove(300, 200 + i);
        await nextFrame();
      }
      pointerUp(300, 230);

      expect(treeRowRenders() - before).toBe(0);
    });

    it("拖拽期间不反复落盘 —— 每帧一次同步写盘会堵住主线程", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
      const { calls } = spyOnStorageWrites();

      const moves = 30;
      pointerDown(slider, 300, 200);
      for (let i = 1; i <= moves; i += 1) {
        pointerMove(300, 200 + i);
        await nextFrame();
      }
      pointerUp(300, 230);

      const writes = calls.filter((k) => k === "notes-sidebar-split-ratio").length;
      expect(writes).toBeLessThanOrEqual(Math.ceil(moves / 4));
    });

    it("拖拽期间关掉高度过渡 —— 过渡开着面板就永远慢半拍地追着指针跑", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
      expect(areaOf("tree").style.transitionProperty).not.toBe("none");

      pointerDown(slider, 300, 200);
      await nextFrame();

      expect(areaOf("tree").style.transitionProperty).toBe("none");
      expect(areaOf("external").style.transitionProperty).toBe("none");

      pointerUp(300, 230);
      await nextFrame();

      expect(areaOf("tree").style.transitionProperty).not.toBe("none");
    });

    it("松手后比例落定在指针的位置上", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整上下区域高度" });
      pointerDown(slider, 300, 200);
      for (let i = 1; i <= 10; i += 1) {
        pointerMove(300, 200 + i);
        await nextFrame();
      }
      pointerUp(300, 260);
      await nextFrame();

      expect(Number(areaOf("external").dataset.splitRatio)).toBeCloseTo(0.25, 5);
      expect(slider.getAttribute("aria-valuenow")).toBe("25");
    });
  });

  describe("宽度分割线（侧栏 | 编辑区）", () => {
    it("拖拽期间目录树不重建", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整侧栏宽度" });
      const before = treeRowRenders();

      pointerDown(slider, 300, 200);
      for (let i = 1; i <= 30; i += 1) {
        pointerMove(300 + i, 200);
        await nextFrame();
      }
      pointerUp(330, 200);

      expect(treeRowRenders() - before).toBe(0);
    });

    it("拖拽期间不反复落盘", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整侧栏宽度" });
      const { calls } = spyOnStorageWrites();

      const moves = 30;
      pointerDown(slider, 300, 200);
      for (let i = 1; i <= moves; i += 1) {
        pointerMove(300 + i, 200);
        await nextFrame();
      }
      pointerUp(330, 200);

      const writes = calls.filter((k) => k === "qnote-notes-sidebar-width").length;
      expect(writes).toBeLessThanOrEqual(Math.ceil(moves / 4));
    });

    it("拖拽期间关掉宽度过渡", async () => {
      await renderNotesPage();

      const slider = screen.getByRole("slider", { name: "调整侧栏宽度" });
      expect(sidebar().style.transitionProperty).not.toBe("none");

      pointerDown(slider, 300, 200);
      await nextFrame();

      expect(sidebar().style.transitionProperty).toBe("none");

      pointerUp(330, 200);
      await nextFrame();

      expect(sidebar().style.transitionProperty).not.toBe("none");
    });
  });
});
