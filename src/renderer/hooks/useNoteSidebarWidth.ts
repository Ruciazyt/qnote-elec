import { useCallback, useEffect, useState } from "react";
import {
  NOTE_SIDEBAR_DEFAULT_WIDTH,
  NOTE_SIDEBAR_MAX_WIDTH,
  NOTE_SIDEBAR_MIN_WIDTH,
} from "@/components/Note/layout";
import { clampPanelWidth } from "@/components/browser/layout";

const WIDTH_KEY = "qnote-notes-sidebar-width";

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return NOTE_SIDEBAR_DEFAULT_WIDTH;
    return clampPanelWidth(raw, NOTE_SIDEBAR_MIN_WIDTH, NOTE_SIDEBAR_MAX_WIDTH);
  } catch {
    return NOTE_SIDEBAR_DEFAULT_WIDTH;
  }
}

/**
 * 笔记页文件树的宽度偏好
 *
 * 和 useBrowserSidePanel 的宽度部分同构，但不复用同一个 hook：
 * 两个页面的 localStorage key、上下限、默认宽度各不相同，合并成一个 hook
 * 反而要处处传参，收益不大。
 *
 * 为什么要持久化：笔记页是 keep-alive 的，切标签不会卸载，
 * 所以「切走再切回来」这一种情况靠组件 state 就够了；
 * 但应用重启后宽度回到 288、和用户上次调过的不一致，仍然会被当成 bug。
 * 落 localStorage 连重启也一并保持。
 *
 * 写盘放在 useEffect 而不是包在 setter 里：setter 内做副作用在 React 严格模式
 * 下会被调用两次，属于典型的反模式。
 */
export function useNoteSidebarWidth(): {
  width: number;
  /** 外部传入的当前上限（随窗口尺寸变化），内部再做一次钳制 */
  setWidth: (width: number, maxWidth?: number) => void;
  resetWidth: () => void;
} {
  const [width, setWidthState] = useState<number>(loadWidth);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // localStorage 不可用时静默降级为「仅本次会话有效」
    }
  }, [width]);

  const setWidth = useCallback((next: number, maxWidth?: number) => {
    setWidthState((prev) =>
      clampPanelWidth(
        next,
        NOTE_SIDEBAR_MIN_WIDTH,
        // 窗口变窄后，之前存的宽度可能已经超出可用范围 → 这里兜底收紧
        Math.min(NOTE_SIDEBAR_MAX_WIDTH, maxWidth ?? NOTE_SIDEBAR_MAX_WIDTH)
      )
    );
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(
      clampPanelWidth(
        NOTE_SIDEBAR_DEFAULT_WIDTH,
        NOTE_SIDEBAR_MIN_WIDTH,
        NOTE_SIDEBAR_MAX_WIDTH
      )
    );
  }, []);

  return { width, setWidth, resetWidth };
}
