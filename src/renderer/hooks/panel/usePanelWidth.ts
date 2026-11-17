import { useCallback, useState } from "react";
import { clampPanelWidth } from "@/components/panel/layout";
import { useCoalescedStorage } from "./useCoalescedStorage";

export interface PanelWidthOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export interface PanelWidthState {
  width: number;
  setWidth: (next: number, limitMax?: number) => void;
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

  useCoalescedStorage(storageKey, String(width));

  const setWidth = useCallback(
    (next: number, limitMax?: number) => {
      setWidthState(() =>
        clampPanelWidth(
          next,
          minWidth,
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
