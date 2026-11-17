// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";


const h = vi.hoisted(() => {
  const state = {
    bounds: { x: 0, y: 0, width: 240, height: 76 },
    destroyed: false,
    visible: false,
    sent: [] as Array<{ channel: string; payload: unknown }>,
    listeners: new Map<string, (...args: unknown[]) => void>(),
    ignoreCalls: [] as Array<{ ignore: boolean; forward: boolean }>,
    topCalls: [] as Array<[boolean, string?]>,
  };

  const win = {
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    once: (event: string, cb: (...args: unknown[]) => void) => {
      state.listeners.set(event, cb);
      return win;
    },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      state.listeners.set(event, cb);
      return win;
    },
    removeAllListeners: () => {
      state.listeners.clear();
    },
    destroy: () => {
      state.destroyed = true;
    },
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    showInactive: () => {
      state.visible = true;
    },
    hide: () => {
      state.visible = false;
    },
    getBounds: () => ({ ...state.bounds }),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
      state.bounds = { ...bounds };
    },
    setPosition: (x: number, y: number) => {
      state.bounds = { ...state.bounds, x, y };
    },
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => {
      state.ignoreCalls.push({ ignore, forward: options?.forward ?? false });
    },
    setAlwaysOnTop: (flag: boolean, level?: string) => {
      state.topCalls.push([flag, level]);
    },
    webContents: {
      send: (channel: string, payload: unknown) => {
        state.sent.push({ channel, payload });
      },
    },
  };

  const displays = {
    1: { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    2: { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  };

  return { state, win, displays };
});

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(() => h.win),
  screen: {
    getPrimaryDisplay: () => h.displays[1],
    getAllDisplays: () => [h.displays[1], h.displays[2]],
    getDisplayNearestPoint: (point: { x: number }) =>
      point && point.x >= 1920 ? h.displays[2] : h.displays[1],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  app: {
    isPackaged: false,
    getPath: () => ".",
  },
}));

import { IslandWindow } from "./island";
import { ISLAND_SHADOW_PAD_X, ISLAND_SHADOW_PAD_Y } from "../../../../shared/island/island";

const CARD_W = 220;
const CARD_H = 44;

function cardBounds(): { x: number; y: number; width: number; height: number } {
  const b = h.state.bounds;
  return {
    x: b.x + ISLAND_SHADOW_PAD_X,
    y: b.y,
    width: b.width - ISLAND_SHADOW_PAD_X * 2,
    height: b.height - ISLAND_SHADOW_PAD_Y,
  };
}

function bootIsland() {
  const island = IslandWindow.getInstance();
  island.show();
  h.state.listeners.get("ready-to-show")?.();
  return island;
}

describe("灵动岛窗口的几何", () => {
  beforeEach(() => {
    h.state.bounds = { x: 0, y: 0, width: CARD_W + ISLAND_SHADOW_PAD_X * 2, height: CARD_H + ISLAND_SHADOW_PAD_Y };
    h.state.destroyed = false;
    h.state.visible = false;
    h.state.sent = [];
    h.state.ignoreCalls = [];
    h.state.topCalls = [];
    h.state.listeners.clear();
  });

  it("贴顶态水平居中在屏幕顶边", () => {
    const island = bootIsland();

    const card = cardBounds();
    expect(card.y).toBe(0);
    expect(card.x).toBe(850);
    expect(island.getSnapshot().attachMode).toBe("attached");
  });

  it("窗口比卡片大一圈 —— 阴影要有地方画，不然底角会被裁成直角", () => {
    bootIsland();

    expect(h.state.bounds.width).toBe(CARD_W + ISLAND_SHADOW_PAD_X * 2);
    expect(h.state.bounds.height).toBe(CARD_H + ISLAND_SHADOW_PAD_Y);
    expect(cardBounds().x).toBe(h.state.bounds.x + ISLAND_SHADOW_PAD_X);
  });

  it("拖动时卡片跟着指针走", () => {
    const island = bootIsland();
    const start = island.getSnapshot().position;

    island.beginDrag(start.x + 10, start.y + 10);
    island.dragTo(start.x + 210, start.y + 410);

    const card = cardBounds();
    expect(card.x).toBe(start.x + 200);
    expect(card.y).toBe(start.y + 400);
  });

  it("拖远了浮在原地，拖回顶边附近吸附回顶边", () => {
    const island = bootIsland();

    island.beginDrag(100, 100);
    island.dragTo(300, 400);
    const floated = island.endDrag();

    expect(floated.attachMode).toBe("floating");
    expect(floated.position).not.toBeNull();
    expect(cardBounds().y).toBe(300);

    island.beginDrag(300, 400);
    island.dragTo(700, 10);
    const attached = island.endDrag();

    expect(attached.attachMode).toBe("attached");
    expect(cardBounds().y).toBe(0);
  });

  it("吸回顶边时横向停在用户放的地方，不弹回正中", () => {
    const island = bootIsland();
    const start = island.getSnapshot().position;

    island.beginDrag(start.x + 10, start.y + 10);
    island.dragTo(start.x - 390, start.y + 350);
    island.endDrag();

    expect(cardBounds().x).toBe(start.x - 400);
    expect(cardBounds().y).toBe(340);

    island.beginDrag(start.x - 400, 340);
    island.dragTo(start.x - 400, 10);
    island.endDrag();

    expect(cardBounds().y).toBe(0);
    expect(cardBounds().x).toBe(start.x - 400);
  });

  it("拖到另一块屏上要记住那块屏 —— 岛不跟着鼠标跑", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.dragTo(2500, 300);
    const result = island.endDrag();

    expect(result.displayId).toBe(2);
    expect(result.position?.x).toBeGreaterThanOrEqual(1920);
  });

  it("浮着的时候也要把 attachMode 推给渲染层 —— 否则角还是贴顶态的直角", () => {
    const island = bootIsland();

    island.beginDrag(100, 100);
    island.dragTo(300, 400);
    island.endDrag();

    const last = h.state.sent[h.state.sent.length - 1];
    expect(last?.channel).toBe("island:state");
    expect((last?.payload as { attachMode: string }).attachMode).toBe("floating");
  });

  it("鼠标不在卡片上时窗口放成穿透，别让那圈透明区域吃掉底下的点击", () => {
    const island = bootIsland();

    island.setInteractive(false);
    expect(h.state.ignoreCalls.at(-1)).toEqual({ ignore: true, forward: true });

    island.setInteractive(true);
    expect(h.state.ignoreCalls.at(-1)).toEqual({ ignore: false, forward: true });
  });

  it("每次显示都重新设一次置顶层级", () => {
    const island = bootIsland();

    expect(h.state.topCalls.at(-1)).toEqual([true, "screen-saver"]);

    const before = h.state.topCalls.length;
    island.hide();
    island.show();

    expect(h.state.topCalls.length).toBeGreaterThan(before);
    expect(h.state.topCalls.at(-1)).toEqual([true, "screen-saver"]);
  });

  it("拖动中不改穿透状态 —— 放行鼠标会让拖动当场断掉", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.setInteractive(false);
    expect(h.state.ignoreCalls.some((call) => call.ignore)).toBe(false);

    island.endDrag();
    expect(h.state.ignoreCalls.at(-1)).toEqual({ ignore: true, forward: true });
  });

  it("重置位置回到主屏顶边正中", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.dragTo(2500, 300);
    island.endDrag();

    island.resetPosition();

    expect(cardBounds().x).toBe(850);
    expect(cardBounds().y).toBe(0);
  });
});
