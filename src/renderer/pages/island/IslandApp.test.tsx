import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IslandApp } from "./IslandApp";
import { createElectronStub } from "@/test/electron-stub";
import type { Todo } from "@/pages/todo/types";


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

const SESSION_A = {
  id: "s-1",
  title: "整理周报",
  preview: "把本周的进展汇总一下",
  created_at: new Date("2026-11-11T10:00:00Z"),
  updated_at: new Date("2026-11-11T10:00:00Z"),
};

const SESSION_B = {
  id: "s-2",
  title: "查接口签名",
  preview: "HMAC 怎么算",
  created_at: new Date("2026-11-10T10:00:00Z"),
  updated_at: new Date("2026-11-10T10:00:00Z"),
};

const STREAM_STUBS = {
  onAiStreamChunk: vi.fn(() => () => {}),
  onAiStreamToolCall: vi.fn(() => () => {}),
  onAiStreamToolResult: vi.fn(() => () => {}),
  onAiStreamEnd: vi.fn(() => () => {}),
  onAiStreamError: vi.fn(() => () => {}),
  onAiCompacting: vi.fn(() => () => {}),
  onAiNeedContinue: vi.fn(() => () => {}),
};

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

function summary(): string {
  return document.querySelector(".island-pill-summary")?.textContent?.trim() ?? "";
}

async function waitForSummary(expected: string): Promise<void> {
  await waitFor(() => {
    expect(summary()).toBe(expected);
  });
}

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
    expect(screen.getByText("复制过来的一段文字")).toBeInTheDocument();
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
    firePointer(pill, "pointermove", { screenX: 120, screenY: 120 });
    expect(dragStart).toHaveBeenCalledWith(100, 100);

    firePointer(pill, "pointermove", { screenX: 180, screenY: 150 });
    firePointer(pill, "pointermove", { screenX: 240, screenY: 180 });
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

    const body = document.querySelector(".island-panel-body");
    if (!body) throw new Error("面板内容区没渲染");
    firePointer(body, "pointerdown", { button: 0, screenX: 10, screenY: 10 });
    firePointer(body, "pointerup", { button: 0, screenX: 10, screenY: 10 });

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

    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    expect(setInteractive).toHaveBeenCalledWith(true);

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

    fireEvent.mouseMove(window, { clientX: 500, clientY: 500 });
    expect(setInteractive).not.toHaveBeenCalledWith(false);

    firePointer(pill, "pointerup", { screenX: 120, screenY: 120 });
  });

  it("AI 页先给出对话列表，能搜、能选", async () => {
    const user = userEvent.setup();
    installStub({
      getAiChatSessions: vi.fn(async () => [SESSION_A, SESSION_B]),
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("AI"));

    expect(await screen.findByLabelText("搜索对话")).toBeInTheDocument();
    expect(await screen.findByText("整理周报")).toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索对话"), "接口");

    expect(screen.queryByText("整理周报")).not.toBeInTheDocument();
    expect(screen.getByText("查接口签名")).toBeInTheDocument();
  });

  it("在对话列表里直接提问会自动新建一个对话", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ sessionId: "s-1" }));
    installStub({
      getAiChatSessions: vi.fn(async () => []),
      createAiChatSession: vi.fn(async () => ({
        id: "new-1",
        title: "新建对话",
        preview: "",
        created_at: new Date("2026-11-11T10:00:00Z"),
        updated_at: new Date("2026-11-11T10:00:00Z"),
      })),
      sendAiAgentStream: send,
      ...STREAM_STUBS,
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("AI"));

    const input = await screen.findByLabelText("发起新对话");
    await user.type(input, "帮我理一下今天的待办{Enter}");

    await waitFor(() => {
      expect(send).toHaveBeenCalled();
    });
    expect(send.mock.calls[0][0]).toBe("帮我理一下今天的待办");
    expect(send.mock.calls[0][2]).toBe("new-1");
  });

  it("选中一个对话进对话态，能返回列表", async () => {
    const user = userEvent.setup();
    installStub({
      getAiChatSessions: vi.fn(async () => [SESSION_A, SESSION_B]),
      getAiChatSessionHistory: vi.fn(async () => [
        {
          id: 1,
          role: "user",
          content: "在吗",
          created_at: new Date("2026-11-11T10:00:00Z"),
        },
        {
          id: 2,
          role: "assistant",
          content: "在的",
          created_at: new Date("2026-11-11T10:01:00Z"),
        },
      ]),
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("AI"));
    await user.click(await screen.findByLabelText("打开对话：整理周报"));

    expect(await screen.findByLabelText("返回对话列表")).toBeInTheDocument();
    expect(await screen.findByText("在吗")).toBeInTheDocument();

    await user.click(screen.getByLabelText("返回对话列表"));

    expect(await screen.findByLabelText("搜索对话")).toBeInTheDocument();
  });

  it("删除对话要二次确认", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async () => true);
    installStub({
      getAiChatSessions: vi.fn(async () => [SESSION_A, SESSION_B]),
      deleteAiChatSession: remove,
    });

    render(<IslandApp />);
    await waitForSummary("把灵动岛做完");

    await user.click(screen.getByLabelText("AI"));
    await user.click(await screen.findByLabelText("删除对话：整理周报"));

    expect(await screen.findByText(/删除「整理周报」？/)).toBeInTheDocument();

    await user.click(screen.getByText("删除"));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("s-1");
    });
  });
});
