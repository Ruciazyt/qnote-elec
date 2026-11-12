import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IslandApp } from "./IslandApp";
import { createElectronStub } from "@/test/electron-stub";
import type { Todo } from "@/components/todo/types";

/**
 * 灵动岛的交互回归用例
 *
 * 盯住三件事：
 *
 * 1. 收起态显示一行摘要，展开态换成面板 —— 两者都在 DOM 里，
 *    靠 data-hidden 互相让位，展开/收起不能让面板里的状态清零。
 * 2. 点模块图标 = 切页 + 展开；点胶囊本身 = 展开/收起。
 * 3. 面板里能直接干活：待办勾选、剪贴板点击即复制 —— 岛不是只读预览。
 */

const TODO: Todo = {
  id: 7,
  title: "把灵动岛做完",
  notes: null,
  priority: "high",
  due_date: null,
  completed: 0,
  completed_at: null,
  archived_at: null,
  created_at: "2026-11-11T10:00:00",
  updated_at: "2026-11-11T10:00:00",
  attachments: [],
};

/** 装一份带灵动岛 API 的桩 */
function installStub(overrides: Record<string, unknown> = {}): void {
  window.electron = createElectronStub({
    islandGetSettings: vi.fn(async () => ({
      enabled: true,
      expandTrigger: "click",
      hoverDelayMs: 300,
      attachMode: "attached",
      position: null,
      displayId: null,
    })),
    islandGetState: vi.fn(async () => ({
      expanded: false,
      page: "todo",
      attachMode: "attached",
      size: { width: 260, height: 44 },
      position: { x: 0, y: 0 },
    })),
    onIslandState: vi.fn(() => () => {}),
    onIslandAiActivity: vi.fn(() => () => {}),
    onTodosChanged: vi.fn(() => () => {}),
    onClipboardChanged: vi.fn(() => () => {}),
    todoList: vi.fn(async () => [TODO]),
    popupGetClipboardHistory: vi.fn(async () => [
      { id: 3, type: "text", content: "复制过来的一段文字", time: "2026-11-11T10:00:00.000Z" },
    ]),
    islandGetRecentNotes: vi.fn(async () => [
      { relPath: "设计.md", name: "设计.md", mtime: Date.now(), type: "markdown" },
    ]),
    islandGetAiActivity: vi.fn(async () => ({
      running: false,
      title: "",
      sessionId: null,
      startedAt: null,
      tool: null,
    })),
    ...overrides,
  });
}

/**
 * 收起胶囊上的那行摘要
 *
 * 摘要文字与面板里的条目标题可能一模一样（待办标题就是摘要），
 * 所以要按容器取，不能用 getByText —— 它撞到多个就抛。
 */
function summary(): string {
  return document.querySelector(".island-pill-summary")?.textContent?.trim() ?? "";
}

/** 等摘要刷成期望值 */
async function waitForSummary(expected: string): Promise<void> {
  await waitFor(() => {
    expect(summary()).toBe(expected);
  });
}

/**
 * 造一个指针事件
 *
 * jsdom 没有 PointerEvent，testing-library 退化成普通 Event ——
 * 那样 button / screenX 全丢，拖动逻辑根本进不去。
 * 用 MouseEvent 顶着 pointerdown/pointermove/pointerup：
 * 类型名对得上 React 的事件系统，坐标与按键又是 MouseEvent 原生支持的。
 */
function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { button?: number; screenX?: number; screenY?: number }
): void {
  fireEvent(
    target,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: init.button ?? 0,
      screenX: init.screenX ?? 0,
      screenY: init.screenY ?? 0,
    })
  );
}

describe("灵动岛", () => {
  beforeEach(() => {
    installStub();
  });

  it("收起时显示一行摘要，展开面板藏在 DOM 里", async () => {
    render(<IslandApp />);

    // 摘要取优先级最高的那条：进行中的待办
    await waitForSummary("把灵动岛做完");

    expect(screen.getByTestId("island-pill")).toHaveAttribute("data-hidden", "false");
    expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "true");
  });

  it("点胶囊上的模块图标会切页并展开", async () => {
    const user = userEvent.setup();
    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("剪贴板"));

    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "false");
    });
    // 面板切到了剪贴板页
    expect(screen.getByText("复制过来的一段文字")).toBeInTheDocument();
    // 但摘要那一行仍按优先级给：进行中的待办压过剪贴板。
    // 摘要回答的是「现在最该看什么」，不是「当前选中的是哪一页」——
    // 与参考实现同口径。
    expect(summary()).toBe("把灵动岛做完");
  });

  it("AI 在跑时摘要让位给 AI 任务", async () => {
    installStub({
      islandGetAiActivity: vi.fn(async () => ({
        running: true,
        title: "正在整理周报",
        sessionId: "s1",
        startedAt: Date.now(),
        tool: null,
      })),
    });
    render(<IslandApp />);
    await waitForSummary("正在整理周报");
  });

  it("没有待办时摘要退到最近一条剪贴板", async () => {
    installStub({ todoList: vi.fn(async () => []) });
    render(<IslandApp />);
    await waitForSummary("复制过来的一段文字");
  });

  it("展开后可以在面板里直接勾选待办", async () => {
    const user = userEvent.setup();
    const toggle = vi.fn(async () => ({ ...TODO, completed: 1 }));
    installStub({ todoToggle: toggle });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("展开灵动岛"));
    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "false");
    });

    await user.click(screen.getByLabelText("完成「把灵动岛做完」"));
    await waitFor(() => {
      expect(toggle).toHaveBeenCalledWith(TODO.id);
    });
  });

  it("Esc 收起展开的面板", async () => {
    const user = userEvent.setup();
    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("展开灵动岛"));
    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "false");
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "true");
    });
  });

  it("拖动越过阈值后要一直跟着光标走", async () => {
    const dragStart = vi.fn();
    const dragMove = vi.fn();
    const dragEnd = vi.fn();
    installStub({
      islandDragStart: dragStart,
      islandDragMove: dragMove,
      islandDragEnd: dragEnd,
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    const pill = screen.getByTestId("island-pill");
    firePointer(pill, "pointerdown", { button: 0, screenX: 100, screenY: 100 });
    // 越过 4px 阈值 —— 这一步之前不该发 drag-start
    firePointer(pill, "pointermove", { screenX: 120, screenY: 120 });
    expect(dragStart).toHaveBeenCalledWith(100, 100);

    // 越过去之后还得继续发 drag-move，岛才会跟着光标走
    firePointer(pill, "pointermove", { screenX: 180, screenY: 150 });
    firePointer(pill, "pointermove", { screenX: 240, screenY: 180 });
    // 位置取的是最后那一下，不是第一次越阈时的位置
    await waitFor(() => {
      expect(dragMove).toHaveBeenLastCalledWith(240, 180);
    });

    firePointer(pill, "pointerup", { screenX: 240, screenY: 180 });
    await waitFor(() => {
      expect(dragEnd).toHaveBeenCalled();
    });
  });

  it("在面板内容区按下不会收起面板", async () => {
    const user = userEvent.setup();
    const dragStart = vi.fn();
    installStub({ islandDragStart: dragStart });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("展开灵动岛"));
    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "false");
    });

    // 在内容区（不是页签行）按下 —— 在那儿是在干活，不是在拖窗口
    const body = document.querySelector(".island-panel-body");
    if (!body) throw new Error("面板内容区没渲染");
    firePointer(body, "pointerdown", { button: 0, screenX: 10, screenY: 10 });
    firePointer(body, "pointerup", { button: 0, screenX: 10, screenY: 10 });

    // 不该发起拖动，更不该在松手时把面板收起
    expect(dragStart).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("island-panel")).toHaveAttribute("data-hidden", "false");
    });
  });

  it("鼠标不在卡片上时把窗口放成穿透", async () => {
    const setInteractive = vi.fn();
    installStub({ islandSetInteractive: setInteractive });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    // jsdom 里 getBoundingClientRect 全是 0 —— 卡片就落在 (0,0) 那个点上
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    expect(setInteractive).toHaveBeenCalledWith(true);

    // 指针走到卡片外面 —— 窗口得放行鼠标事件，
    // 不然那圈给阴影留的透明区域会把底下应用的点击吃掉
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });

  it("拖动中不改窗口的穿透状态 —— 放行鼠标会让拖动当场断掉", async () => {
    const setInteractive = vi.fn();
    installStub({ islandSetInteractive: setInteractive, islandDragStart: vi.fn() });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    const pill = screen.getByTestId("island-pill");
    firePointer(pill, "pointerdown", { button: 0, screenX: 100, screenY: 100 });
    firePointer(pill, "pointermove", { screenX: 120, screenY: 120 });

    // 指针跑到卡片外面 —— 但手还按着，穿透状态不能动。
    // 窗口一放行鼠标，指针捕获就丢了，拖动会断在原地。
    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 });
    expect(setInteractive).not.toHaveBeenCalledWith(false);

    firePointer(pill, "pointerup", { screenX: 120, screenY: 120 });
  });

  it("AI 页可以直接对话", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ sessionId: "s-1" }));
    installStub({
      sendAiAgentStream: send,
      getAiChatSessionHistory: vi.fn(async () => []),
      onAiStreamChunk: vi.fn(() => () => {}),
      onAiStreamEnd: vi.fn(() => () => {}),
      onAiStreamError: vi.fn(() => () => {}),
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    // 点胶囊上的 AI 图标 = 切到 AI 页并展开
    await user.click(screen.getByLabelText("AI"));

    const input = await screen.findByLabelText("给 AI 发消息");
    await user.type(input, "帮我理一下今天的待办{Enter}");

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    expect(send.mock.calls[0][0]).toBe("帮我理一下今天的待办");
    // 走的是默认 AI 会话 —— 岛里问的，主窗口的助手接着看得到
    expect(send.mock.calls[0][2]).toBe("default-ai-chat");
  });
});
