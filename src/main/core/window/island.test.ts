// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 灵动岛窗口的几何回归
 *
 * 这里锁的是主进程这一侧的窗口几何：
 *   - 窗口要比卡片大一圈 —— 不然阴影被窗口矩形裁掉，底角变成直角
 *   - 拖动时卡片要真的跟着指针走
 *   - 拖到离顶边 16px 以外 → 浮在原地；拖回顶边附近 → 吸附回顶边，
 *     但横向停在用户放的地方，不弹回正中
 *   - 岛落在哪块屏上要记住 —— 它不跟着鼠标换屏
 *
 * 渲染层发的是屏幕坐标，主进程据此算卡片该在哪儿 ——
 * 这一段算错了，岛就表现为「拖不动」或者「拖完弹回中间」。
 */

const h = vi.hoisted(() => {
  /** 假窗口的几何 —— 主进程改它，测试就盯着它 */
  const state = {
    bounds: { x: 0, y: 0, width: 240, height: 76 },
    destroyed: false,
    visible: false,
    /** 推给渲染层的消息 */
    sent: [] as Array<{ channel: string; payload: unknown }>,
    /** 窗口事件回调 */
    listeners: new Map<string, (...args: unknown[]) => void>(),
    /** setIgnoreMouseEvents 的调用记录 */
    ignoreCalls: [] as Array<{ ignore: boolean; forward: boolean }>,
    /** setAlwaysOnTop 的调用记录 */
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

  /** 两块假显示器：主屏在左，副屏在右（横向接上） */
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
    // 横向落在 1920 之后的算副屏
    getDisplayNearestPoint: (point: { x: number }) =>
      point && point.x >= 1920 ? h.displays[2] : h.displays[1],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  app: {
    // 打包态会去拼 process.resourcesPath 下的 HTML —— 测试环境里那个值是 undefined，
    // 拼路径直接抛。走开发态分支，loadURL 有桩接住。
    isPackaged: false,
    getPath: () => ".",
  },
}));

import { IslandWindow } from "./island";
import { ISLAND_SHADOW_PAD_X, ISLAND_SHADOW_PAD_Y } from "../../../shared/island";

/** 卡片尺寸（收起态） */
const CARD_W = 220;
const CARD_H = 44;

/**
 * 卡片在窗口里的位置与尺寸
 *
 * 窗口四周留着一圈阴影的位置，卡片在里面偏左上角，
 * 所以卡片的坐标要从窗口坐标里扣掉那圈留白。
 */
function cardBounds(): { x: number; y: number; width: number; height: number } {
  const b = h.state.bounds;
  return {
    x: b.x + ISLAND_SHADOW_PAD_X,
    y: b.y,
    width: b.width - ISLAND_SHADOW_PAD_X * 2,
    height: b.height - ISLAND_SHADOW_PAD_Y,
  };
}

/** 造一个已就绪、已显示的岛 */
function bootIsland() {
  const island = IslandWindow.getInstance();
  island.show();
  // 触发 ready-to-show（窗口创建时挂的回调）
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
    // 卡片宽 220，屏幕宽 1920 → x = (1920 - 220) / 2 = 850
    expect(card.x).toBe(850);
    expect(island.getSnapshot().attachMode).toBe("attached");
  });

  it("窗口比卡片大一圈 —— 阴影要有地方画，不然底角会被裁成直角", () => {
    bootIsland();

    expect(h.state.bounds.width).toBe(CARD_W + ISLAND_SHADOW_PAD_X * 2);
    expect(h.state.bounds.height).toBe(CARD_H + ISLAND_SHADOW_PAD_Y);
    // 卡片在窗口里居中（贴顶态），左右各留出一半
    expect(cardBounds().x).toBe(h.state.bounds.x + ISLAND_SHADOW_PAD_X);
  });

  it("拖动时卡片跟着指针走", () => {
    const island = bootIsland();
    const start = island.getSnapshot().position;

    island.beginDrag(start.x + 10, start.y + 10);
    island.dragTo(start.x + 210, start.y + 410);

    // 指针位移 (200, 400) → 卡片跟着位移同样的量
    const card = cardBounds();
    expect(card.x).toBe(start.x + 200);
    expect(card.y).toBe(start.y + 400);
  });

  it("拖远了浮在原地，拖回顶边附近吸附回顶边", () => {
    const island = bootIsland();

    // 往下拖 300px → 离顶边够远 → 浮着
    island.beginDrag(100, 100);
    island.dragTo(300, 400);
    const floated = island.endDrag();

    expect(floated.attachMode).toBe("floating");
    expect(floated.position).not.toBeNull();
    expect(cardBounds().y).toBe(300);

    // 再拖回顶边 → 吸附回顶边
    island.beginDrag(300, 400);
    island.dragTo(700, 10);
    const attached = island.endDrag();

    expect(attached.attachMode).toBe("attached");
    expect(cardBounds().y).toBe(0);
  });

  it("吸回顶边时横向停在用户放的地方，不弹回正中", () => {
    const island = bootIsland();
    const start = island.getSnapshot().position;

    // 往左下拖 —— 横向离开正中（卡片跟着指针走 400px）
    island.beginDrag(start.x + 10, start.y + 10);
    island.dragTo(start.x - 390, start.y + 350);
    island.endDrag();

    expect(cardBounds().x).toBe(start.x - 400);
    expect(cardBounds().y).toBe(340);

    // 再拖回顶边：纵向吸回去，横向留在原处
    island.beginDrag(start.x - 400, 340);
    island.dragTo(start.x - 400, 10);
    island.endDrag();

    expect(cardBounds().y).toBe(0);
    expect(cardBounds().x).toBe(start.x - 400);
  });

  it("拖到另一块屏上要记住那块屏 —— 岛不跟着鼠标跑", () => {
    const island = bootIsland();

    // 拖到副屏（横向 1920 之后）
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

    // 最高一档：压在别的应用的 topmost 窗口与全屏应用之上
    expect(h.state.topCalls.at(-1)).toEqual([true, "screen-saver"]);

    // 隐藏再显示 —— Windows 会把透明层窗口的 always-on-top 状态丢掉，
    // 掉了岛就变回普通窗口，随便什么窗口都能盖住它
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
    // 拖动中：窗口照旧接收鼠标，指针捕获不能丢
    expect(h.state.ignoreCalls.some((call) => call.ignore)).toBe(false);

    // 拖完了才生效
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
