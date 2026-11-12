import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NotesPage from "./NotesPage";
import { createElectronStub } from "../test/electron-stub";
import type { NoteTreeNode } from "../../shared/noteTypes";

/**
 * 笔记页分割线拖拽的流畅度
 *
 * 这里锁的不是「拖了会不会变」，而是**拖的过程本身**。
 * 分割线在指针下必须 1:1 跟手，中间不能夹着过渡动画，
 * 也不能每一帧都把整棵目录树重渲染一遍、每帧都同步写一次 localStorage。
 *
 * 这三样都是「能跑、但卡」的来源 —— 只看结果值全绿，看不出问题。
 *
 * ## 怎么量「目录树有没有被重建」
 *
 * 目录树的行不是独立组件，没法直接数它渲染了几次。
 * 但每一行渲染时都会查一次类型元数据（getNoteTypeMeta）——
 * 把这层 mock 掉计数，就等于数了「渲染了多少行」。
 *
 * 树里的文件一律用 markdown 之外的类型（pdf），
 * 页面自己那一次查询走 activeType，两边不会串台。
 */

const counters = vi.hoisted(() => ({
  /** 按类型统计 getNoteTypeMeta 的调用次数 —— 即「渲染了多少个文件行」 */
  byType: new Map<string, number>(),
}));

vi.mock("../../shared/noteTypes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/noteTypes")>();
  return {
    ...actual,
    getNoteTypeMeta: (type: string) => {
      counters.byType.set(type, (counters.byType.get(type) ?? 0) + 1);
      return actual.getNoteTypeMeta(type as Parameters<typeof actual.getNoteTypeMeta>[0]);
    },
  };
});

vi.mock("@/components/Note/editors/ExcalidrawEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(function MockExcalidrawEditor() {
      return null;
    }),
  };
});

/** 树里所有文件的类型 —— 与页面自身的 activeType 区分开 */
const TREE_TYPE = "pdf";

/** 一棵有分量的目录树 —— 200 个文件，够让「整棵树重渲染」变成可观的开销 */
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

/** 树行被重渲染的次数 */
function treeRowRenders(): number {
  return counters.byType.get(TREE_TYPE) ?? 0;
}

/**
 * 造一个指针事件
 *
 * jsdom 没有 PointerEvent，用 MouseEvent 顶着 —— React 的合成事件照样
 * 从原生事件上取 clientX / clientY，够用了。
 */
function pointerEvent(type: string, clientX: number, clientY = 0): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
}

/** 在元素上按下 */
function pointerDown(el: Element, clientX: number, clientY = 0) {
  act(() => {
    el.dispatchEvent(pointerEvent("pointerdown", clientX, clientY));
  });
}

/** 在 window 上移动 */
function pointerMove(clientX: number, clientY = 0) {
  act(() => {
    window.dispatchEvent(pointerEvent("pointermove", clientX, clientY));
  });
}

/** 在 window 上松手 */
function pointerUp(clientX: number, clientY = 0) {
  act(() => {
    window.dispatchEvent(pointerEvent("pointerup", clientX, clientY));
  });
}

/**
 * 走一帧
 *
 * 分割线把 pointermove 攒到 requestAnimationFrame 里统一处理，
 * 所以移动之后要等一帧，宽度/比例才真的变。
 *
 * 假时钟下 rAF 是 16ms 的定时器，推进 16ms 就等于过了一帧。
 */
async function nextFrame() {
  await act(async () => {
    vi.advanceTimersByTime(16);
  });
}

/** 某一块的容器 */
function areaOf(kind: "tree" | "external"): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-notes-split="${kind}"]`);
  if (!el) throw new Error(`没有找到 ${kind} 那块`);
  return el;
}

/** 侧栏本体 */
function sidebar(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-notes-sidebar]");
  if (!el) throw new Error("没有找到侧栏");
  return el;
}

/**
 * jsdom 没有布局，getBoundingClientRect() 全是 0。
 *
 * 分割线在开始拖拽前要量一次容器高度，量到 0 就直接放弃拖拽 ——
 * 于是所有 pointermove 都被吞掉，用例看起来像「分割线没反应」。
 * 这里给一个固定的假盒子：宽 300、高 400。
 */
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

/** 统计 localStorage.setItem 的调用次数（按 key 分） */
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
    // 假时钟：帧数与写盘次数都要是可复现的，不能看机器快慢
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

      // 30 次移动，树一行都没重渲染 —— 说明 memo 生效、props 引用稳定
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
      // 连续变化被合并成「每 150ms 写一次」，不再是每帧一次。
      // 上限取「移动次数 / 4」——比这密就是在拖拽的每一帧里插同步 IO。
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

      // 松手后过渡要回来 —— 收起/展开还得靠它
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

      // 容器高 400，往下拖 60px = 15% → 比例 0.4 - 0.15 = 0.25
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
