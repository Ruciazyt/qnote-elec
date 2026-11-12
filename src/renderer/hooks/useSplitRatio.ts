import { useCallback, useState } from "react";
import { useCoalescedStorage } from "./useCoalescedStorage";

/**
 * 上下分栏的高度比例（带 localStorage 持久化）
 *
 * ## 为什么用比例而不是像素
 *
 * 上下两块共享同一个容器，容器高度随窗口变。写死像素的话，
 * 窗口一拉高，上块就留出一大片空白 —— 比例则始终成立（40% 就是 40%）。
 *
 * ## 与 usePanelWidth 是一对
 *
 * usePanelWidth 管的是**宽度**偏好，这套管的是**高度**比例：
 * 读盘、钳制、写盘、兜底四步完全一样，只是值的含义不同。
 *
 * ## 两个必须做对的细节
 *
 * 1. **读盘要挡住 0**：localStorage 里没有这个 key 时 getItem 返回 null，
 *    Number(null) 是 0（不是 NaN）—— 直接用会把比例钳到下限，
 *    用户的默认 6:4 就没了。
 * 2. **写盘放在 useEffect**：包在 setter 里做副作用在 React 严格模式下
 *    会被调用两次，属于典型的反模式。
 *
 * ## 写盘为什么走 useCoalescedStorage
 *
 * 拖上下分割线时比例每一帧都在变，每次都同步写一次 localStorage 就是在
 * 拖拽的每一帧里插一段阻塞 IO。useCoalescedStorage 把连续变化合并成
 * 一次写盘（拖完写一次），一次性改动（按方向键）仍然立刻落盘。
 */
export interface SplitRatioOptions {
  /** localStorage key（建议按页面语义命名） */
  storageKey: string;
  /** 首次使用的默认比例（0..1） */
  defaultRatio: number;
  /** 允许的最小比例 */
  minRatio: number;
  /** 允许的最大比例 */
  maxRatio: number;
}

export interface SplitRatioState {
  /** 当前比例（已钳制过） */
  ratio: number;
  /** 设置比例（自动钳制到上下限） */
  setRatio: (next: number) => void;
  /** 恢复到默认比例 */
  resetRatio: () => void;
}

export function useSplitRatio({
  storageKey,
  defaultRatio,
  minRatio,
  maxRatio,
}: SplitRatioOptions): SplitRatioState {
  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, minRatio), Math.max(minRatio, maxRatio)),
    [minRatio, maxRatio]
  );

  const [ratio, setRatioState] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem(storageKey));
      // 读不到（null → 0）或存的值不合法时回默认值
      if (!Number.isFinite(raw) || raw <= 0) return clamp(defaultRatio);
      return clamp(raw);
    } catch {
      return clamp(defaultRatio);
    }
  });

  useCoalescedStorage(storageKey, String(ratio));

  const setRatio = useCallback((next: number) => setRatioState(clamp(next)), [clamp]);

  const resetRatio = useCallback(() => setRatioState(clamp(defaultRatio)), [clamp, defaultRatio]);

  return { ratio, setRatio, resetRatio };
}
