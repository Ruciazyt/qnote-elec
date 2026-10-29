import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  clampPanelWidth,
  type SidePanelView,
} from "@/components/browser/layout";

const VIEW_KEY = "qnote-browser-side-panel";
const WIDTH_KEY = "qnote-browser-side-panel-width";

function loadView(): SidePanelView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw === "bookmarks" || raw === "ai" ? raw : null;
  } catch {
    return null;
  }
}

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return SIDE_PANEL_DEFAULT_WIDTH;
    return clampPanelWidth(raw, SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH);
  } catch {
    return SIDE_PANEL_DEFAULT_WIDTH;
  }
}

/**
 * 浏览器页侧栏的偏好：展开哪个视图 + 拖出来的宽度
 *
 * ## 为什么必须持久化，不能只放组件里
 *
 * App.tsx 用的是 react-router 的 <Routes>，切到别的路由会把 BrowserPage
 * 整个卸载。组件内的 useState 随之销毁，用户切回来时侧栏就被重置成收起，
 * 每次都得重新点开 —— 而网页标签页（在主进程托管）却是完好的，
 * 于是出现"页面还在、侧栏没了"的割裂感。
 *
 * 落 localStorage 而不是模块级变量，是为了连"重启应用后"也能保持。
 *
 * 写盘放在 useEffect 而不是包在 setter 里：setter 内做副作用在 React 严格模式
 * 下会被调用两次，属于典型的反模式。
 *
 * ## 默认值
 *
 * 视图默认收起、宽度默认 288：保持首次使用时的原有观感，
 * 用户主动调过之后就一直记住。
 */
export function useBrowserSidePanel(): {
  view: SidePanelView | null;
  setView: Dispatch<SetStateAction<SidePanelView | null>>;
  width: number;
  /** 外部传入的当前上限（随窗口尺寸变化），内部再做一次钳制 */
  setWidth: (width: number, maxWidth?: number) => void;
  resetWidth: () => void;
} {
  const [view, setView] = useState<SidePanelView | null>(loadView);
  const [width, setWidthState] = useState<number>(loadWidth);

  useEffect(() => {
    try {
      if (view) localStorage.setItem(VIEW_KEY, view);
      else localStorage.removeItem(VIEW_KEY);
    } catch {
      // localStorage 不可用时静默降级为"仅本次会话有效"
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // 同上
    }
  }, [width]);

  const setWidth = useCallback((next: number, maxWidth?: number) => {
    setWidthState((prev) =>
      clampPanelWidth(
        next,
        SIDE_PANEL_MIN_WIDTH,
        // 窗口变窄后，之前存的宽度可能已经超出可用范围 → 这里兜底收紧
        Math.min(SIDE_PANEL_MAX_WIDTH, maxWidth ?? SIDE_PANEL_MAX_WIDTH)
      )
    );
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(
      clampPanelWidth(SIDE_PANEL_DEFAULT_WIDTH, SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH)
    );
  }, []);

  return { view, setView, width, setWidth, resetWidth };
}
