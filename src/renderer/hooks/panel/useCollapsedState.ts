import { useEffect, useState } from "react";

export function useCollapsedState(
  storageKey: string,
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
    }
  }, [storageKey, value]);

  return [value, setValue];
}