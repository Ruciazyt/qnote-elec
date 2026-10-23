import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useAiAssistant } from "@/hooks/useAiAssistant";
import { useNativeViewCover } from "@/hooks/useNativeViewCover";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { toast } from "@/hooks/use-toast";
import { AiChatPanel } from "../clipboard/AiChatPanel";
import { AiChatSessionsPanel } from "../clipboard/AiChatSessionsPanel";
import { PixelPet } from "./PixelPet";
import { PetSpeechBubble, BUBBLE_WIDTH } from "./PetSpeechBubble";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 360;
const PANEL_EDGE_GAP = 16;
/**
 * 折叠态宠物的尺寸（像素）
 *
 * 必须等于 PixelPet 的 CELL(32) * SCALE(2) = 64，且是整数倍：
 * 非整数倍缩放会让精灵图出现半像素边界，像素边缘发虚。
 * 这个常量同时驱动拖动/边界裁剪的定位计算，改它必须同步 PixelPet 的渲染尺寸。
 */
const BALL_SIZE = 64;
/** 顶部标题栏高度 — 浮框不能拖到标题栏下方 */
const TITLE_BAR_HEIGHT = 40;
/** 拖动距离超过这个阈值视为"真的在拖动"，否则视为点击 */
const DRAG_THRESHOLD_PX = 3;

interface PanelPosition {
  right: number;
  bottom: number;
}

/**
 * 面板往哪一侧展开
 * - left  = 面板右边缘对齐球的右边缘，向左生长
 * - right = 面板左边缘对齐球的左边缘，向右生长
 *
 * 为什么需要它：位置只存了 right/bottom，天然只能表达"往左开"。
 * 球被拖到窗口左侧时，面板会整体溢出屏幕被裁掉（早期版本就是这个 bug）。
 */
type OpenSide = "left" | "right";

type ResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelResizeStart extends PanelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: ResizeDirection;
}

const RESIZE_HANDLES: {
  direction: ResizeDirection;
  label: string;
  className: string;
}[] = [
  { direction: "n", label: "上边缘", className: "inset-x-3 top-0 h-2 cursor-ns-resize" },
  { direction: "e", label: "右边缘", className: "inset-y-3 right-0 w-2 cursor-ew-resize" },
  { direction: "s", label: "下边缘", className: "inset-x-3 bottom-0 h-2 cursor-ns-resize" },
  { direction: "w", label: "左边缘", className: "inset-y-3 left-0 w-2 cursor-ew-resize" },
  { direction: "nw", label: "左上角", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize rounded-tl-lg" },
  { direction: "ne", label: "右上角", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize rounded-tr-lg" },
  { direction: "se", label: "右下角", className: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-br-lg" },
  { direction: "sw", label: "左下角", className: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize rounded-bl-lg" },
];

/**
 * 语音气泡相对浮框的垂直间距
 */
const BUBBLE_GAP = 10;
/** 气泡离视口边缘的最小留白 */
const BUBBLE_VIEWPORT_MARGIN = 12;
/**
 * 气泡尾巴距气泡左右边缘的最小距离
 *
 * 宠物被拖到很靠左的位置时，气泡右边缘会被视口夹动，尾巴需要一路挪到气泡左端附近；
 * 但尾巴必须留在气泡**内**，否则会变成飘在气泡外面的一小块方块。
 */
const BUBBLE_TAIL_INSET = 16;

/**
 * 浮框锚点位置（右下角偏移）的边界裁剪
 * - 上限：不能拖到标题栏下方（顶部必须 >= TITLE_BAR_HEIGHT）
 * - 下限：不能拖到视口外
 */
function clampPosition(pos: PanelPosition, panelWidth: number, panelHeight: number): PanelPosition {
  const maxRight = Math.max(0, window.innerWidth - panelWidth);
  // 顶部不能进入标题栏区域：bottom 最大为 innerHeight - panelHeight - TITLE_BAR_HEIGHT
  const maxBottom = Math.max(
    0,
    window.innerHeight - panelHeight - TITLE_BAR_HEIGHT
  );
  return {
    right: Math.min(Math.max(0, pos.right), maxRight),
    bottom: Math.min(Math.max(0, pos.bottom), maxBottom),
  };
}

/**
 * 决定面板往哪边开
 * @param ballRight 折叠态宠物的右边缘 x 坐标
 *
 * 两边都放得下时保持原有的"向左开"，避免平时无端改变观感；
 * 只有某一侧放不下、或者两侧都放不下时，才按空间大小改换方向。
 */
function resolveOpenSide(ballRight: number, panelWidth: number): OpenSide {
  const vw = window.innerWidth;
  const ballLeft = ballRight - BALL_SIZE;
  const roomLeft = ballRight;   // 向左开：右边缘贴球右边，左侧剩多少
  const roomRight = vw - ballLeft; // 向右开：左边缘贴球左边，右侧剩多少

  if (roomLeft >= panelWidth) return "left";
  if (roomRight >= panelWidth) return "right";
  // 都放不下 —— 选宽的一侧，同时由 fitPanel 负责收窄尺寸
  return roomLeft >= roomRight ? "left" : "right";
}

/**
 * 把展开态的面板收进视口，并换算回 right-space 的锚点
 *
 * 返回值可直接喂给样式：无论朝哪边开，面板最终都用 right/bottom 定位，
 * 所以渲染层不需要知道自己朝的是哪边。
 *
 * @param ballRight   折叠宠物的右边缘 x 坐标
 * @param ballBottom  折叠宠物的 bottom 偏移（CSS 的 bottom 值）
 *
 * 底部必须以"宠物原本的 bottom"为基准，只向上收拢、绝不主动下压：
 * 面板是宠物的展开形态，两者的垂直关系应当保持一致，
 * 否则宠物停在哪里、面板就开在哪里，视觉上才是同一个东西在变大。
 */
function fitPanel(
  ballRight: number,
  ballBottom: number,
  panelSize: { width: number; height: number },
  openSide: OpenSide
): { size: { width: number; height: number }; position: PanelPosition } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ballLeft = ballRight - BALL_SIZE;

  const room = openSide === "left" ? ballRight : vw - ballLeft;
  const width = clampPanelDimension(
    panelSize.width,
    MIN_PANEL_WIDTH,
    room - PANEL_EDGE_GAP
  );
  const height = clampPanelDimension(
    panelSize.height,
    MIN_PANEL_HEIGHT,
    vh - TITLE_BAR_HEIGHT - PANEL_EDGE_GAP
  );

  const left = openSide === "left" ? ballRight - width : ballLeft;
  return {
    size: { width, height },
    position: {
      right: Math.max(0, vw - left - width),
      // 底部：先沿用宠物当前的 bottom，
      // 再确保"面板顶 + TITLE_BAR_HEIGHT <= 视口高"，即不会顶进标题栏。
      // 只做减法式收拢，不加 TITLE_BAR_HEIGHT —— 早期版本把它算进去，
      // 导致面板永远贴着标题栏，窗口越高底部抬得越离谱。
      bottom: Math.min(
        ballBottom,
        Math.max(0, vh - height - TITLE_BAR_HEIGHT)
      ),
    },
  };
}

/** 将尺寸限制在最小值与当前视口可用空间之间。 */
function clampPanelDimension(value: number, min: number, available: number): number {
  const max = Math.max(1, available);
  return Math.min(Math.max(value, Math.min(min, max)), max);
}

/** 根据被拖动的边或角计算新尺寸，并固定其对边或对角。 */
function resizePanelFromDelta(
  start: PanelResizeStart,
  horizontalDelta: number,
  verticalDelta: number
): { size: { width: number; height: number }; position: PanelPosition } {
  let width = start.width;
  let height = start.height;
  let right = start.right;
  let bottom = start.bottom;

  if (start.direction.includes("w")) {
    width = clampPanelDimension(
      start.width - horizontalDelta,
      MIN_PANEL_WIDTH,
      window.innerWidth - start.right
    );
  } else if (start.direction.includes("e")) {
    width = clampPanelDimension(
      start.width + horizontalDelta,
      MIN_PANEL_WIDTH,
      start.width + start.right
    );
    right = Math.max(0, start.right - (width - start.width));
  }

  if (start.direction.includes("n")) {
    height = clampPanelDimension(
      start.height - verticalDelta,
      MIN_PANEL_HEIGHT,
      window.innerHeight - start.bottom - TITLE_BAR_HEIGHT
    );
  } else if (start.direction.includes("s")) {
    height = clampPanelDimension(
      start.height + verticalDelta,
      MIN_PANEL_HEIGHT,
      start.height + start.bottom
    );
    bottom = Math.max(0, start.bottom - (height - start.height));
  }

  return { size: { width, height }, position: { right, bottom } };
}

/**
 * FloatingAiAssistant — AI 助手全局浮框
 *
 * 两种状态：
 * - 折叠态：右下角悬浮像素宠物，AI 思考时切换为思考动画
 * - 展开态：右下角悬浮卡片（~380×560），内含完整聊天 UI
 *
 * 交互：
 * - 猫 / 卡片均可拖动（猫：单击展开，拖动重定位；卡片：从头部拖动）
 * - 状态通过 IPC 同步到主进程并广播给其他 Electron 窗口
 *   （主窗口、剪贴板 popup、AI popup 共享同一份位置 + 展开状态）
 */
export function FloatingAiAssistant() {
  const ai = useAiAssistant();
  // 浏览器页挂载期间需要让位给原生 WebContentsView
  const coveredByNativeView = useNativeViewCover();

  /**
   * 宠物语音通路
   *
   * 与对话框里的麦克风按钮共用 useVoiceInput —— 切换式语义、错误处理、
   * 录音上限全部一致，只有"识别出来之后往哪送"不同：
   * 输入框是填进 aiInput 供用户确认，气泡是直接送给 AI 并把回复流进气泡。
   */
  const voice = useVoiceInput({
    onTranscribed: (text) => ai.sendPetVoiceMessage(text),
  });

  /** 一次「开始录音 / 结束并提问」 */
  const handleVoiceToggle = useCallback(async () => {
    const idle = voice.phase === "idle" || voice.phase === "error";
    if (idle) {
      ai.beginPetVoice();
      await voice.toggle();
      return;
    }
    if (voice.phase === "recording" || voice.phase === "starting") {
      // 先把气泡切到"识别中"，否则录音停止到识别返回之间气泡停在
      // "正在听…"，看起来像是还在录
      ai.patchPetBubble({ phase: "transcribing" });
      await voice.toggle();
    }
  }, [ai, voice]);

  // 全局快捷键：收起为宠物时用。再按一次结束录音并提问
  useEffect(() => {
    return window.electron.onVoiceHotkeyTriggered(() => {
      if (coveredByNativeView) {
        // 原生 WebContentsView 盖住整个渲染层，此时宠物和气泡都看不见，
        // 录音会变成一段完全无声无息的过程。明确告知比默默吞掉好。
        toast({
          title: "当前页面无法显示语音气泡",
          description: "内嵌浏览器页面会遮挡浮动界面，请切回其它页面后再试。",
        });
        return;
      }
      void handleVoiceToggle();
    });
  }, [coveredByNativeView, handleVoiceToggle]);

  // 识别出错时把气泡切到失败态；否则错误只存在于 voice.error 里，气泡会
  // 永远停在"正在听…"。
  useEffect(() => {
    if (voice.error && ai.petBubble) {
      ai.patchPetBubble({ phase: "error", error: voice.error });
    }
  }, [voice.error, ai]);

  // 初始状态：先 local fallback，然后异步从主进程拉取真实状态
  const [expanded, setExpanded] = useState<boolean>(true);
  const [panelSize, setPanelSize] = useState({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const [position, setPosition] = useState<PanelPosition>({ right: 20, bottom: 20 });
  /** 展开时面板的朝向；折叠态无意义，展开那一刻才决定 */
  const [openSide, setOpenSide] = useState<OpenSide>("left");
  const [stateReady, setStateReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // 拖动状态 — 用 ref 避免触发重渲染
  const dragStartRef = useRef<{
    x: number;
    y: number;
    right: number;
    bottom: number;
    /** 是否真的移动过（超过 DRAG_THRESHOLD_PX） */
    moved: boolean;
  } | null>(null);
  const resizeStartRef = useRef<PanelResizeStart | null>(null);

  /**
   * 尺寸 + 位置一起更新 ——
   * fitPanel 算出的 position 是尺寸的函数，分两次 setState 会有一帧错位
   */
  const setPanelSizeAndPosition = useCallback(
    (next: { size: { width: number; height: number }; position: PanelPosition }) => {
      setPanelSize(next.size);
      setPosition(next.position);
    },
    []
  );

  /**
   * 拖动结束后拦截紧随的 click 事件
   * 因为浏览器可能在我们判定 "moved" 后仍然触发 click（受浏览器内部 click 阈值影响），
   * 用 flag 在 onClick 入口直接吞掉这一次点击。
   */
  const suppressNextClickRef = useRef(false);

  /**
   * 拖动期间 IPC 节流 — 50ms 内只同步一次给主进程，
   * 减少跨窗口广播频率，避免拖动时其他窗口卡顿
   */
  const positionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPositionRef = useRef<PanelPosition | null>(null);

  // 初始加载：从主进程拉取跨窗口共享状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await window.electron.getFloatingAiState();
        if (cancelled) return;
        if (state.position) {
          if (state.expanded) {
            // 跨窗口共享的位置是在别的窗口尺寸下算出来的，直接套用可能溢出本窗口
            setPosition(
              clampPosition(state.position, panelSize.width, panelSize.height)
            );
          } else {
            setPosition(state.position);
          }
        }
        if (typeof state.expanded === "boolean") setExpanded(state.expanded);
      } catch (err) {
        console.error("[floating-ai] 加载跨窗口状态失败", err);
      } finally {
        if (!cancelled) setStateReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 跨窗口广播监听 — 收到其他窗口的更新
  useEffect(() => {
    const offPos = window.electron.onFloatingAiPositionUpdated((p) => {
      // 本窗口拖动时不响应广播（避免回环）
      if (isInteractingRef.current) return;
      setPosition(p);
      // 别的窗口尺寸可能和本窗口不同，照搬位置会溢出屏幕 —— 展开态必须重新收拢
      if (expanded) {
        const panelRight = window.innerWidth - p.right;
        const ballRight =
          openSide === "left" ? panelRight : panelRight + panelSize.width - BALL_SIZE;
        // 收到的 p 已经是别的窗口算好的锚点，其 bottom 直接沿用
        setPanelSizeAndPosition(fitPanel(ballRight, p.bottom, panelSize, openSide));
      }
    });
    const offExp = window.electron.onFloatingAiExpandedUpdated((e) => {
      setExpanded(e);
    });
    return () => {
      offPos();
      offExp();
    };
  }, [expanded, openSide, panelSize, setPanelSizeAndPosition]);

  /**
   * 同步位置到主进程 — 拖动期间节流 50ms，松手立即同步
   * 主进程负责持久化 + 广播给其他窗口
   */
  const syncPositionToMain = useCallback((next: PanelPosition, immediate = false) => {
    pendingPositionRef.current = next;
    if (immediate) {
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
        positionSyncTimerRef.current = null;
      }
      window.electron.setFloatingAiPosition(next);
      pendingPositionRef.current = null;
      return;
    }
    if (positionSyncTimerRef.current) return; // 已有 pending
    positionSyncTimerRef.current = setTimeout(() => {
      positionSyncTimerRef.current = null;
      if (pendingPositionRef.current) {
        window.electron.setFloatingAiPosition(pendingPositionRef.current);
        pendingPositionRef.current = null;
      }
    }, 50);
  }, []);

  /** 同步展开状态到主进程 */
  const syncExpandedToMain = useCallback((next: boolean) => {
    window.electron.setFloatingAiExpanded(next);
  }, []);

  // 位置变化时同步到主进程（仅拖动后的最终位置或受广播影响时）
  // 拖动期间由 onMove 自己负责节流同步
  useEffect(() => {
    if (!stateReady) return; // 初始加载期间不同步（避免覆盖主进程真实状态）
    // 拖动中由 onMove 主动同步，松开后这里会再触发一次（无害 — 同一位置）
    if (isDragging || isResizing) return;
    syncPositionToMain(position, true);
  }, [position, stateReady, isDragging, isResizing, syncPositionToMain]);

  // 展开状态变化时同步到主进程
  useEffect(() => {
    if (!stateReady) return;
    syncExpandedToMain(expanded);
  }, [expanded, stateReady, syncExpandedToMain]);

  // 窗口大小变化时，约束位置（避免被拖到屏幕外的位置无法恢复）
  useEffect(() => {
    const handleResize = () => {
      if (!expanded) {
        // 折叠态：只需要保证宠物仍在视口内
        setPosition((prev) =>
          clampPosition(prev, BALL_SIZE, BALL_SIZE)
        );
        return;
      }
      // 展开态：按当前朝向重新收拢。
      // 朝向本身不因 resize 改变 —— 改朝向会让面板在用户拖窗口时来回跳，
      // 只需把尺寸和位置收进当前朝向允许的范围内即可。
      const panelRight = window.innerWidth - position.right;
      const ballRight = openSide === "left" ? panelRight : panelRight + panelSize.width - BALL_SIZE;
      setPanelSizeAndPosition(fitPanel(ballRight, position.bottom, panelSize, openSide));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded, openSide, panelSize, position.right, position.bottom, setPanelSizeAndPosition]);

  // 组件卸载时清理节流定时器
  useEffect(() => {
    return () => {
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
      }
    };
  }, []);

  // 用于广播监听里判断是否是本窗口拖动造成的回环
  const isInteractingRef = useRef(false);
  useEffect(() => {
    isInteractingRef.current = isDragging || isResizing;
  }, [isDragging, isResizing]);

  // 全局 pointermove / pointerup 监听 — 仅在拖动中挂载
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        start.moved = true;
      }
      const w = expanded ? panelSize.width : BALL_SIZE;
      const h = expanded ? panelSize.height : BALL_SIZE;
      // drag right (+) → 面板 right 减小（向屏幕中心移动）
      // drag down (+) → 面板 bottom 减小
      const rawRight = start.right - dx;
      const rawBottom = start.bottom - dy;
      const maxRight = Math.max(0, window.innerWidth - w);
      // 顶部预留标题栏高度 — 不能拖进标题栏下方
      const maxBottom = Math.max(
        0,
        window.innerHeight - h - TITLE_BAR_HEIGHT
      );
      const next: PanelPosition = {
        right: Math.min(Math.max(0, rawRight), maxRight),
        bottom: Math.min(Math.max(0, rawBottom), maxBottom),
      };
      setPosition(next);
      // 节流同步到主进程（跨窗口广播 + 持久化）
      syncPositionToMain(next);
    };

    const onUp = () => {
      const start = dragStartRef.current;
      if (start?.moved) {
        // 标记吞掉紧随的 click 事件（防止浏览器在拖动后仍触发 click）
        suppressNextClickRef.current = true;
        // 安全兜底：即使 click 因某些原因没触发，也要在 100ms 后复位
        // 避免后续正常点击被永久吞掉
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 100);
      }
      // 拖动结束：立即同步最终位置（不等节流）
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
        positionSyncTimerRef.current = null;
      }
      if (pendingPositionRef.current) {
        syncPositionToMain(pendingPositionRef.current, true);
      }
      dragStartRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, expanded, panelSize]);

  // 全局 pointermove / pointerup 监听 — 仅在调整大小时挂载
  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;

      const next = resizePanelFromDelta(
        start,
        e.clientX - start.x,
        e.clientY - start.y
      );
      setPanelSize(next.size);
      setPosition(next.position);
    };

    const onUp = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isResizing]);

  const beginDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return; // 仅响应左键
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        right: position.right,
        bottom: position.bottom,
        moved: false,
      };
      setIsDragging(true);
      // 防止文本选中
      e.preventDefault();
      // 锁定指针 — 即使用户拖出元素也能继续接收事件
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [position]
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, direction: ResizeDirection) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: panelSize.width,
        height: panelSize.height,
        right: position.right,
        bottom: position.bottom,
        direction,
      };
      setIsResizing(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [panelSize, position]
  );

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, direction: ResizeDirection) => {
      const step = e.shiftKey ? 32 : 16;
      let horizontalDelta = 0;
      let verticalDelta = 0;
      if (e.key === "ArrowLeft") horizontalDelta = -step;
      else if (e.key === "ArrowRight") horizontalDelta = step;
      else if (e.key === "ArrowUp") verticalDelta = -step;
      else if (e.key === "ArrowDown") verticalDelta = step;
      else return;

      if (!direction.includes("e") && !direction.includes("w")) {
        horizontalDelta = 0;
      }
      if (!direction.includes("n") && !direction.includes("s")) {
        verticalDelta = 0;
      }
      if (horizontalDelta === 0 && verticalDelta === 0) return;

      e.preventDefault();
      e.stopPropagation();
      const next = resizePanelFromDelta(
        {
          x: 0,
          y: 0,
          width: panelSize.width,
          height: panelSize.height,
          right: position.right,
          bottom: position.bottom,
          direction,
        },
        horizontalDelta,
        verticalDelta
      );
      setPanelSize(next.size);
      setPosition(next.position);
    },
    [panelSize, position]
  );

  const handleExpand = useCallback(() => {
    if (!expanded) {
      // 球当前占据的位置就是面板的锚点 —— 朝向由这里决定
      const ballRight = window.innerWidth - position.right;
      const side = resolveOpenSide(ballRight, panelSize.width);
      setOpenSide(side);
      setPanelSizeAndPosition(fitPanel(ballRight, position.bottom, panelSize, side));
    }
    setExpanded(true);
  }, [expanded, position.right, panelSize]);

  const handleCollapse = useCallback(() => {
    if (openSide === "right") {
      // 面板是往右开的，小球要回到面板的左下角，否则会平移到右下角——
      // 表现为"收起后球突然跳了一下"
      const panelLeft = window.innerWidth - position.right - panelSize.width;
      setPosition((prev) => ({
        ...prev,
        right: Math.max(0, window.innerWidth - panelLeft - BALL_SIZE),
      }));
    }
    setExpanded(false);
  }, [openSide, position.right, panelSize.width]);

  // 球的 pointerdown — 启动拖动判定
  const handleBallPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => beginDrag(e),
    [beginDrag]
  );

  // 卡片头部 pointerdown — 仅拖动，不触发任何单击动作
  const handleCardHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => beginDrag(e),
    [beginDrag]
  );

  // 球的 onClick — 拦截拖动后的浏览器原生 click，避免误展开
  const handleBallClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleExpand();
    },
    [handleExpand]
  );

  /**
   * 语音气泡的定位
   *
   * 锚在浮动界面的**正上方**，右边缘与浮动界面对齐 —— 未被夹动时，气泡的尾巴
   * （BALL_SIZE / 2 处）正好落在宠物中心。收起态浮动界面就是宠物本身，
   * 所以"宠物在哪，气泡就在哪"，不需要两套坐标。
   *
   * 水平方向必须夹进视口：宠物可以被拖到屏幕最左，固定 offset 的气泡
   * 会整体溢出被裁掉（这正是 fitPanel 当初踩过的坑）。
   *
   * ## 尾巴为什么要单独算
   *
   * 被夹动时气泡是**整体平移**的，尾巴若留在固定偏移上就会指向宠物旁边的空气 ——
   * 表现为"宠物在左边时气泡对不上"。所以这里把平移量补进来：
   * 尾巴距气泡右边缘 = 宠物中心距视口右边 − 气泡右边缘距视口右边。
   * 再夹进 [BUBBLE_TAIL_INSET, width − BUBBLE_TAIL_INSET] 保证尾巴不跑到气泡外面。
   */
  const bubbleStyle = useMemo(() => {
    const containerHeight = expanded ? panelSize.height : BALL_SIZE;
    const maxWidth = Math.max(
      200,
      Math.min(BUBBLE_WIDTH, window.innerWidth - BUBBLE_VIEWPORT_MARGIN * 2)
    );
    const maxRight = Math.max(
      BUBBLE_VIEWPORT_MARGIN,
      window.innerWidth - maxWidth - BUBBLE_VIEWPORT_MARGIN
    );
    const right = Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.right), maxRight);

    // 展开态锚的是宠物，收起态锚的是面板；两种情况都用容器的右边缘推算宠物中心。
    const petCenterFromRight = position.right + BALL_SIZE / 2;
    const tailOffset = Math.min(
      Math.max(BUBBLE_TAIL_INSET, petCenterFromRight - right),
      Math.max(BUBBLE_TAIL_INSET, maxWidth - BUBBLE_TAIL_INSET)
    );

    return {
      width: maxWidth,
      right,
      bottom: position.bottom + containerHeight + BUBBLE_GAP,
      tailOffset,
    };
  }, [expanded, panelSize.height, position.right, position.bottom]);

  return (
    <>
      {/* 浮框锚点容器 — 用 inline style 控制位置（其他样式仍走 Tailwind） */}
      <div
        className="fixed z-40"
        style={{
          // 内嵌浏览器的 WebContentsView 是原生视图，永远盖在渲染进程之上，
          // z-index 无解。浏览器页挂载期间整体隐藏（保留挂载态，切回即恢复原状）。
          display: coveredByNativeView ? "none" : undefined,
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
          width: expanded ? panelSize.width : BALL_SIZE,
          height: expanded ? panelSize.height : BALL_SIZE,
          // 拖动时关闭过渡，避免定位更新被动画延迟；松手后恢复
          // 包含 right / bottom 让 窗口 resize 触发的位置 clamp 平滑过渡
          transition: isDragging || isResizing
            ? "none"
            : "right 200ms ease-out, bottom 200ms ease-out, width 300ms ease-out, height 300ms ease-out",
        }}>
        {expanded ? (
          <div
            className="h-full w-full bg-card shadow-2xl rounded-lg border border-border/60 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 origin-bottom-right duration-200"
            role="dialog"
            aria-label="AI 助手">
            {/* 自定义 header — 整个 header 都是拖动区域（按钮除外） */}
            <FloatingCardHeader
              aiLoading={ai.aiLoading}
              isDragging={isDragging}
              assistantView={ai.assistantView}
              activeSessionTitle={ai.activeChatSession?.title ?? "新建对话"}
              sessionCount={ai.chatSessions.length}
              isCreatingSession={ai.isCreatingSession}
              onHeaderPointerDown={handleCardHeaderPointerDown}
              onShowSessions={ai.handleShowSessions}
              onNewChat={ai.handleNewChat}
              onCollapse={handleCollapse}
            />
            <div className="flex-1 min-h-0">
              {ai.assistantView === "sessions" ? (
                <AiChatSessionsPanel
                  sessions={ai.chatSessions}
                  isLoading={ai.sessionsLoading}
                  isCreatingSession={ai.isCreatingSession}
                  aiInput={ai.aiInput}
                  aiLoading={ai.aiLoading}
                  onNewChat={ai.handleNewChat}
                  onSelectSession={ai.handleOpenChatSession}
                  onDeleteSession={ai.handleDeleteChatSession}
                  onInputChange={ai.setAiInput}
                  onKeyDown={ai.handleKeyDown}
                  onSendAiMessage={ai.handleSendAiMessage}
                />
              ) : (
                <AiChatPanel
                  chatMessages={ai.chatMessages}
                  aiInput={ai.aiInput}
                  aiLoading={ai.aiLoading}
                  isHistoryLoading={ai.chatHistoryLoading}
                  streamingMessage={ai.streamingMessage}
                  compacting={ai.compacting}
                  pendingContinuation={ai.pendingContinuation}
                  onContinueDecision={ai.handleContinueDecision}
                  skills={ai.skills}
                  activeSkillId={ai.activeSkillId}
                  onSelectSkill={ai.setActiveSkillId}
                  chatEndRef={ai.chatEndRef}
                  onSendAiMessage={ai.handleSendAiMessage}
                  onCancelAiMessage={ai.handleCancelAiMessage}
                  onInputChange={ai.setAiInput}
                  onKeyDown={ai.handleKeyDown}
                  className="bg-card"
                />
              )}
            </div>
            {RESIZE_HANDLES.map(({ direction, label, className }) => (
              <button
                key={direction}
                type="button"
                onPointerDown={(e) => handleResizePointerDown(e, direction)}
                onKeyDown={(e) => handleResizeKeyDown(e, direction)}
                className={cn(
                  "absolute z-10 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  className
                )}
                aria-label={`调整 AI 助手大小：${label}`}
                title={`拖动${label}调整大小`}
              />
            ))}
          </div>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={handleBallPointerDown}
                  onClick={handleBallClick}
                  className={cn(
                    // 无底衬、无边框：只显示宠物本身。
                    // 按钮尺寸仍为 BALL_SIZE，纯粹作为点击热区与拖动命中区，
                    // 视觉上不可见 —— 保证点击区域稳定，不会因为去掉底衬而变小。
                    "group relative flex items-center justify-center",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
                    // 入场只做淡入，不用 zoom-in-*：
                    // zoom 会等比缩放元素，导致精灵图被非整数倍重采样而糊掉
                    "animate-in fade-in origin-bottom-right duration-200",
                    isDragging ? "pixel-pet-dragging" : "pixel-pet-action"
                  )}
                  style={{ width: BALL_SIZE, height: BALL_SIZE }}
                  aria-label="展开 AI 助手">
                  {/* 状态优先级：拖拽 > 思考 > 待机。
                      拖拽排最高是因为它是"手指正在操作"的即时反馈，
                      此时 AI 是否在请求用户并不关心；反过来若让思考压过拖拽，
                      用户会在拖动途中看到宠物突然低头思考，像卡了一帧。 */}
                  <PixelPet
                    anim={isDragging ? "drag" : ai.aiLoading ? "thinking" : "idle"}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>
                <p className="text-xs">展开 AI 助手 · 可拖动</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/*
       * 语音气泡 —— 与浮动界面**平级**，不塞在浮动容器里面。
       *
       * 塞进去的话，气泡会继承容器的拖动 / 尺寸过渡逻辑，且在展开态下
       * 会被面板的 overflow-hidden 裁掉。平级渲染才能各自独立定位。
       *
       * **只在收起态渲染**：气泡是宠物态的专属反馈载体（见 PetSpeechBubble 的说明）。
       * 面板展开时这一轮已经进了对话记录，气泡再浮在面板上方就成了重复内容 ——
       * 而且它锚在面板顶端，看起来像"挂在右上角的一块浮层"。
       *
       * coveredByNativeView 时一并隐藏：原生视图永远盖在渲染层之上，
       * 此时气泡是看不见的，留着只会挡住点击。
       */}
      {ai.petBubble && !expanded && !coveredByNativeView && (
        <div
          className="fixed z-40"
          style={{
            right: `${bubbleStyle.right}px`,
            bottom: `${bubbleStyle.bottom}px`,
            width: `${bubbleStyle.width}px`,
          }}>
          <PetSpeechBubble
            state={ai.petBubble}
            level={voice.level}
            onDismiss={ai.dismissPetBubble}
            tailOffset={bubbleStyle.tailOffset}
          />
        </div>
      )}
    </>
  );
}

/** 浮框卡片的 header — 整个非按钮区域都是拖动手柄 */
function FloatingCardHeader({
  aiLoading,
  isDragging,
  assistantView,
  activeSessionTitle,
  sessionCount,
  isCreatingSession,
  onHeaderPointerDown,
  onShowSessions,
  onNewChat,
  onCollapse,
}: {
  aiLoading: boolean;
  isDragging: boolean;
  assistantView: "sessions" | "chat";
  activeSessionTitle: string;
  sessionCount: number;
  isCreatingSession: boolean;
  onHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onShowSessions: () => void;
  onNewChat: () => void;
  onCollapse: () => void;
}) {
  return (
    <div
      onPointerDown={onHeaderPointerDown}
      className={cn(
        // 与下方内容区同色（bg-card），去掉分割线和半透明 — 让 header 和 content 视觉连续
        "flex items-center justify-between px-3 py-2 bg-card shrink-0 select-none",
        // 拖动手感：未拖动显示 grab，拖动中显示 grabbing
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}>
      <div className="flex items-center gap-2 min-w-0">
          {assistantView === "chat" && (
            <Button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onShowSessions}
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 hover:bg-muted"
              aria-label="返回会话列表"
              title="返回会话列表">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        <div className="relative h-7 w-7 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-primary" />
          {aiLoading && (
            <span className="absolute inset-0 rounded-lg ring-1 ring-primary/30 animate-pulse" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-medium text-sm leading-tight truncate">
            {assistantView === "sessions" ? "Sessions" : activeSessionTitle}
          </h3>
          <p className="text-[10px] text-muted-foreground/70 leading-tight">
            {assistantView === "sessions"
              ? `${sessionCount} 个对话`
              : aiLoading
                ? "思考中…"
                : "AI 助手"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {/* 按钮需 stopPropagation 防止触发拖动 */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onNewChat}
                disabled={isCreatingSession}
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                aria-label="新建对话"
                title="新建对话">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">新建对话</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onCollapse}
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                aria-label="收起为悬浮球">
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">收起</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}