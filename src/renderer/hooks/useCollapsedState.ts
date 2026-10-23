import { useEffect, useState } from "react";

/**
 * useCollapsedState — 带 localStorage 持久化的折叠/展开状态
 * 用法与 useState 完全一致，但状态会跨页面切换/重启保留
 */
export function useCollapsedState(
  /** localStorage key（建议按页面语义命名） */
  storageKey: string,
  /** 默认值（true = 默认收起） */
  defaultValue: boolean = false
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return defaultValue;
      return raw === "true";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      // ignore
    }
  }, [storageKey, value]);

  return [value, setValue];
}