import { useCallback, useEffect, useState } from "react";
import { clampPanelWidth } from "@/components/panel/layout";

/**
 * 面板宽度的持久化偏好
 *
 * ## 抽出这个 hook 的原因
 *
 * 「侧栏宽度由用户拖出来、记在 localStorage 里」这件事，
 * 浏览器页（useBrowserSidePanel）、笔记页（useNoteSidebarWidth）
 * 各写了一遍：读盘、钳制、写盘、兜底收缩，四个步骤一模一样，
 * 只有 key 和上下限不同。合并成一个之后，新增页面（比如应用管理页）
 * 只要给一组上下限就能用，不必再抄一遍。
 *
 * ## 两个必须做对的细节
 *
 * 1. **上限是动态的**：窗口缩小时，之前存的宽度可能已经超出可用范围。
 *    所以 setWidth 的第二个参数是「当前上限」，内部取它与静态上限的较小值。
 * 2. **写盘放在 useEffect**：包在 setter 里做副作用在 React 严格模式下
 *    会被调用两次，属于典型的反模式。
 */
export interface PanelWidthOptions {
  /** localStorage key（建议按页面语义命名） */
  storageKey: string;
  /** 首次使用的默认宽度 */
  defaultWidth: number;
  /** 允许的最小宽度 */
  minWidth: number;
  /** 允许的最大宽度（静态上限） */
  maxWidth: number;
}

export interface PanelWidthState {
  /** 当前宽度（已按静态上下限钳制过） */
  width: number;
  /**
   * 设置宽度
   *
   * @param next 目标宽度
   * @param limitMax 当前可用上限（随窗口尺寸变化）；不传则用静态上限
   */
  setWidth: (next: number, limitMax?: number) => void;
  /** 恢复到默认宽度 */
  resetWidth: (limitMax?: number) => void;
}

export function usePanelWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: PanelWidthOptions): PanelWidthState {
  const [width, setWidthState] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(storageKey));
      if (!Number.isFinite(raw) || raw <= 0) return defaultWidth;
      return clampPanelWidth(raw, minWidth, maxWidth);
    } catch {
      return defaultWidth;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // localStorage 不可用时静默降级为「仅本次会话有效」
    }
  }, [storageKey, width]);

  const setWidth = useCallback(
    (next: number, limitMax?: number) => {
      setWidthState((prev) =>
        clampPanelWidth(
          next,
          minWidth,
          // 窗口变窄后，之前存的宽度可能已经超出可用范围 → 这里兜底收紧
          Math.min(maxWidth, limitMax ?? maxWidth)
        )
      );
    },
    [maxWidth, minWidth]
  );

  const resetWidth = useCallback(
    (limitMax?: number) => {
      setWidthState(
        clampPanelWidth(
          defaultWidth,
          minWidth,
          Math.min(maxWidth, limitMax ?? maxWidth)
        )
      );
    },
    [defaultWidth, maxWidth, minWidth]
  );

  return { width, setWidth, resetWidth };
}
