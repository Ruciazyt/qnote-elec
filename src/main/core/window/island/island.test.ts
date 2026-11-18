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
import {
  ISLAND_EXPANDED_HEIGHT,
  ISLAND_EXPANDED_WIDTH,
  ISLAND_STRIP_WIDTH,
} from "../../../../shared/island/island";

const CARD_W = ISLAND_EXPANDED_WIDTH;
const CARD_H = 44;

function cardBounds(): { x: number; y: number; width: number; height: number } {
  return { ...h.state.bounds };
}

function bootIsland() {
  const island = IslandWindow.getInstance();
  island.show();
  h.state.listeners.get("ready-to-show")?.();
  return island;
}

describe("灵动岛窗口的几何", () => {
  beforeEach(() => {
    h.state.bounds = { x: 0, y: 0, width: CARD_W, height: CARD_H };
    h.state.destroyed = false;
    h.state.visible = false;
    h.state.sent = [];
    h.state.ignoreCalls = [];
    h.state.topCalls = [];
    h.state.listeners.clear();
    IslandWindow.getInstance().resetPosition();
  });

  it("贴顶态水平居中在屏幕顶边", () => {
    const island = bootIsland();

    const card = cardBounds();
    expect(card.y).toBe(0);
    expect(card.x).toBe(760);
    expect(island.getSnapshot().attachMode).toBe("attached");
    expect(island.getSnapshot().dockEdge).toBe("top");
  });

  it("窗口就是卡片本身 —— 去掉阴影后不留那一圈空白", () => {
    bootIsland();

    expect(h.state.bounds.width).toBe(CARD_W);
    expect(h.state.bounds.height).toBe(CARD_H);
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
    expect(attached.dockEdge).toBe("top");
    expect(cardBounds().y).toBe(0);
  });

  it("拖到左边缘吸成竖条，贴着屏幕左边", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.dragTo(5, 300);
    const result = island.endDrag();

    expect(result.attachMode).toBe("attached");
    expect(result.dockEdge).toBe("left");
    expect(h.state.bounds.width).toBe(ISLAND_STRIP_WIDTH);
    expect(h.state.bounds.height).toBe(ISLAND_EXPANDED_HEIGHT);
    expect(h.state.bounds.x).toBe(0);
    expect(h.state.bounds.y).toBe(260);
  });

  it("拖到右边缘时按指针所在那块屏吸附 —— 卡片中心越过边界也不跳到隔壁屏", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.dragTo(1900, 300);
    const result = island.endDrag();

    expect(result.dockEdge).toBe("right");
    expect(result.displayId).toBe(1);
    expect(h.state.bounds.width).toBe(ISLAND_STRIP_WIDTH);
    expect(h.state.bounds.x).toBe(1920 - ISLAND_STRIP_WIDTH);
  });

  it("拖到右边缘吸成竖条，贴着屏幕右边", () => {
    const island = bootIsland();

    island.beginDrag(900, 40);
    island.dragTo(1750, 300);
    const result = island.endDrag();

    expect(result.attachMode).toBe("attached");
    expect(result.dockEdge).toBe("right");
    expect(h.state.bounds.width).toBe(ISLAND_STRIP_WIDTH);
    expect(h.state.bounds.x).toBe(1920 - ISLAND_STRIP_WIDTH);
  });

  it("侧边展开只变宽，高度保持不变", () => {
    vi.useFakeTimers();
    try {
      const island = bootIsland();

      island.beginDrag(900, 40);
      island.dragTo(5, 300);
      island.endDrag();

      expect(h.state.bounds.width).toBe(ISLAND_STRIP_WIDTH);
      expect(h.state.bounds.height).toBe(ISLAND_EXPANDED_HEIGHT);

      island.expand();
      vi.advanceTimersByTime(600);

      expect(h.state.bounds.width).toBe(ISLAND_EXPANDED_WIDTH);
      expect(h.state.bounds.height).toBe(ISLAND_EXPANDED_HEIGHT);
      expect(h.state.bounds.x).toBe(0);

      island.collapse();
      vi.advanceTimersByTime(400);
      expect(h.state.bounds.width).toBe(ISLAND_STRIP_WIDTH);
    } finally {
      vi.useRealTimers();
    }
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

    expect(cardBounds().x).toBe(760);
    expect(cardBounds().y).toBe(0);
    expect(island.getSnapshot().dockEdge).toBe("top");
  });
});
