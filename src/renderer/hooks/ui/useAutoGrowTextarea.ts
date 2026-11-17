import { useCallback, useEffect, useRef } from "react";

export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.overflowY = "hidden";
    const next = el.scrollHeight;
    el.style.height = `${next}px`;
    el.style.overflowY = next > el.clientHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return ref;
}