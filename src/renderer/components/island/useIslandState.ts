import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_ISLAND_SETTINGS,
  ISLAND_DRAG_THRESHOLD,
  type IslandAttachMode,
  type IslandPage,
  type IslandSettings,
} from "@shared/island";

/**
 * 灵动岛的状态与配置
 *
 * 真相在主进程（窗口几何、展开与否都由那边驱动），这里只是把状态镜像过来，
 * 再把用户的动作转成 IPC 发回去。
 */
export interface IslandController {
  /** 是否展开 */
  expanded: boolean;
  /** 当前页签 */
  page: IslandPage;
  /** 贴顶还是浮着 */
  attachMode: IslandAttachMode;
  /** 配置 */
  settings: IslandSettings;
  setPage: (page: IslandPage) => void;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
  updateSettings: (patch: Partial<IslandSettings>) => Promise<void>;
}

export function useIslandState(): IslandController {
  const [expanded, setExpanded] = useState(false);
  const [page, setPageState] = useState<IslandPage>("todo");
  const [attachMode, setAttachMode] = useState<IslandAttachMode>("attached");
  const [settings, setSettings] = useState<IslandSettings>(DEFAULT_ISLAND_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    void window.electron
      .islandGetSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        /* 读不到就用默认值，岛照样能用 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.electron.onIslandState((state) => {
      setExpanded(state.expanded);
      setPageState(state.page);
      setAttachMode(state.attachMode);
    });
  }, []);

  const setPage = useCallback((next: IslandPage) => {
    setPageState(next);
    window.electron.islandSetPage(next);
  }, []);

  const expand = useCallback(() => {
    setExpanded(true);
    window.electron.islandExpand();
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    window.electron.islandCollapse();
  }, []);

  const toggle = useCallback(() => {
    // 本地先翻转，不等主进程回话 —— 那一来一回有几十毫秒，
    // 攒在一起就是「点了没反应」的观感。主进程随后会推一次真状态回来对齐。
    setExpanded((prev) => !prev);
    window.electron.islandToggle();
  }, []);

  const updateSettings = useCallback(async (patch: Partial<IslandSettings>) => {
    const next = await window.electron.islandSetSettings(patch);
    setSettings(next);
  }, []);

  return { expanded, page, attachMode, settings, setPage, expand, collapse, toggle, updateSettings };
}

/**
 * 拖动岛
 *
 * ## 为什么按下时不立刻通知主进程
 *
 * 主进程要记住「抓住的是窗口的哪个位置」，这需要按下那一刻的屏幕坐标。
 * 但如果按下就发，**每一次点击都会触发一次拖放流程** —— 主进程会重算
 * 贴顶/浮动状态并往数据库写一次配置，纯属噪音。
 *
 * 所以改成：按下只记在本地，移动超过阈值才把「按下时的坐标」补发给主进程，
 * 让它建立锚点。松手时若始终没超过阈值，这次交互就是一次普通点击。
 *
 * ## 四件让拖动不卡的事
 *
 * 1. **越过阈值之后要继续发 drag-move**。只发一次的话岛会停在原地，
 *    看起来就是「拖不动」。
 * 2. **按下时抓住指针**（setPointerCapture）。收起态的岛只有 44px 高，
 *    光标往下一挪就出了这块地方，没有指针捕获事件就断了，拖到一半停住。
 * 3. **位置直接发，别攒到下一帧**。攒一帧就是白白多等 16ms（60Hz），
 *    岛会慢半拍，看着就是「不太跟鼠标」。
 *    pointermove 本身已经是按帧派发的，一帧挪一次窗口正合适；
 *    真来了比帧更密的移动（高刷鼠标），才退回去攒到下一帧，
 *    别让 IPC 频率超过帧率 —— 窗口挪得比帧还快反而会抖。
 * 4. **拖动期间不改窗口的穿透状态**。窗口一放行鼠标，指针捕获就丢，
 *    拖动会当场断在原地。
 */
/** 两次 drag-move 之间至少隔这么久（ms）—— 再密就退回去攒到下一帧 */
const MIN_SEND_INTERVAL = 8;

export function useIslandDrag(onClick: () => void) {
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** 当前是不是正在拖动（用来保证「结束拖动」只做一次） */
  const draggingRef = useRef(false);
  /**
   * 指针是不是还按着
   *
   * 按着的时候**不能改窗口的鼠标穿透状态**：窗口一放行鼠标，
   * 指针捕获就丢了，拖动当场断在原地（岛停在半路不动）。
   *
   * 拖动时卡片比指针慢一帧，指针越过卡片边缘就会被判成「不在卡片上」——
   * 这时候若把窗口放成穿透，拖动必断。
   */
  const pressingRef = useRef(false);
  /** 待发的最新坐标 */
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  /** 已排队的动画帧 */
  const frameRef = useRef<number | null>(null);
  /** 上一条 drag-move 是什么时候发的 */
  const lastSentAtRef = useRef(0);

  const flush = useCallback(() => {
    frameRef.current = null;
    const point = pendingRef.current;
    pendingRef.current = null;
    if (!point) return;
    lastSentAtRef.current = Date.now();
    window.electron.islandDragMove(point.x, point.y);
  }, []);

  /** 撤掉排队的帧 —— 要直接发的时候先把攒着的那条清掉 */
  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // 只认左键 —— 右键是系统菜单，中键不做任何事
    if (event.button !== 0) return;
    // 抓住指针：光标移出这块小地方时，事件仍然送回这个元素
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 环境不支持就算了，不影响其余流程 */
    }
    draggingRef.current = false;
    pressingRef.current = true;
    startRef.current = { x: event.screenX, y: event.screenY, moved: false };
  }, []);

  /**
   * 结束拖动 —— 幂等
   *
   * 三条路都会走到这儿：正常松手、指针被系统取消、指针捕获被释放
   * （鼠标在窗口外松开时，捕获会丢，pointerup 收不到）。
   * 少了最后一条，岛会一直粘在光标上。
   */
  const endDrag = useCallback(() => {
    // 先把「按着」清掉 —— 不管这次到底算不算拖动，按钮都该松手了
    pressingRef.current = false;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.electron.islandDragEnd();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (!start.moved) {
        const dx = event.screenX - start.x;
        const dy = event.screenY - start.y;
        if (Math.hypot(dx, dy) < ISLAND_DRAG_THRESHOLD) return;
        start.moved = true;
        draggingRef.current = true;
        // 补发按下时的坐标 —— 主进程据此算「抓住了窗口的哪个位置」
        window.electron.islandDragStart(start.x, start.y);
      }
      // 记下最新位置
      pendingRef.current = { x: event.screenX, y: event.screenY };

      // 距上次发送够久就直接发 —— 等下一帧会慢半拍
      const now = Date.now();
      if (now - lastSentAtRef.current >= MIN_SEND_INTERVAL) {
        lastSentAtRef.current = now;
        cancelFrame();
        flush();
        return;
      }

      // 太密 —— 攒到下一帧补发，别让 IPC 频率超过帧率
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(flush);
      }
    },
    [cancelFrame, flush]
  );

  const onPointerUp = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    pressingRef.current = false;
    cancelFrame();
    if (!start) return;
    if (start.moved) {
      // 最后一帧的位置要发出去 —— 松手那一刻岛得落在指针上，
      // 不然岛会比指针慢一帧，看着就是「拖不干净」
      cancelFrame();
      flush();
      endDrag();
      return;
    }
    pendingRef.current = null;
    onClick();
  }, [endDrag, onClick, flush, cancelFrame]);

  // 组件卸载时把还挂着的帧撤掉
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, endDrag, pressingRef };
}
