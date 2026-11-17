import { useCallback, useState } from "react";
import { useCoalescedStorage } from "./useCoalescedStorage";

export interface SplitRatioOptions {
  storageKey: string;
  defaultRatio: number;
  minRatio: number;
  maxRatio: number;
}

export interface SplitRatioState {
  ratio: number;
  setRatio: (next: number) => void;
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
