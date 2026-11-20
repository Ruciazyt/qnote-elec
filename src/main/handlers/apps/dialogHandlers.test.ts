// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handlers,
    listeners,
    open: vi.fn(),
    close: vi.fn(),
    getContext: vi.fn(),
    send: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn);
    },
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.listeners.set(channel, fn);
    },
  },
}));

vi.mock("../../core/system/log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../core/window/mainWindow", () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: h.send } }),
}));

vi.mock("../../core/window/apps/dialogWindow", () => ({
  dialogWindowManager: {
    open: h.open,
    close: h.close,
    getContext: h.getContext,
  },
}));

import { registerDialogHandlers } from "./dialogHandlers";

function invoke(channel: string, ...args: unknown[]): unknown {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`没有注册 ${channel}`);
  return fn({}, ...args);
}

function send(channel: string, ...args: unknown[]): void {
  const fn = h.listeners.get(channel);
  if (!fn) throw new Error(`没有注册 ${channel}`);
  fn({}, ...args);
}

describe("弹框窗口 IPC", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.listeners.clear();
    registerDialogHandlers();
  });

  it("打开弹框窗口", async () => {
    const res = await invoke("dialog:open", {
      type: "publish",
      payload: { name: "iChain Dev Console" },
    });

    expect(res).toEqual({ ok: true });
    expect(h.open).toHaveBeenCalledWith("publish", {
      name: "iChain Dev Console",
    });
  });

  it("缺少类型时不打开", async () => {
    const res = await invoke("dialog:open", {});
    expect(res).toEqual({ ok: false, error: "缺少弹框类型" });
    expect(h.open).not.toHaveBeenCalled();
  });

  it("读回当前上下文", async () => {
    h.getContext.mockReturnValue({ type: "publish", payload: {} });
    const res = await invoke("dialog:context-get");
    expect(res).toEqual({ type: "publish", payload: {} });
  });

  it("取消、确认、发布成功都会关掉弹框", () => {
    for (const action of ["cancelled", "confirm", "published", "closed"]) {
      h.close.mockClear();
      send("dialog:message", { action });
      expect(h.close).toHaveBeenCalled();
    }
  });

  it("确认运行的动作会同时转给主窗口", () => {
    send("dialog:message", {
      action: "confirm",
      payload: { manifestHash: "abc", projectId: 9 },
    });

    expect(h.send).toHaveBeenCalledWith("dialog:message", {
      action: "confirm",
      payload: { manifestHash: "abc", projectId: 9 },
    });
  });

  it("不认识的动作只转发，不关弹框", () => {
    send("dialog:message", { action: "whatever" });

    expect(h.close).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledWith("dialog:message", {
      action: "whatever",
      payload: {},
    });
  });
});
