import { useCallback, useEffect, useRef } from "react";

export function useAutoGrowTextarea(value: string, maxHeight?: number) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const maxHeightRef = useRef(maxHeight);
  maxHeightRef.current = maxHeight;

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const styles = window.getComputedStyle(el);
    const minHeight = parseFloat(styles.minHeight) || 0;
    const cssMaxHeight = parseFloat(styles.maxHeight) || 0;
    const border =
      (parseFloat(styles.borderTopWidth) || 0) +
      (parseFloat(styles.borderBottomWidth) || 0);

    const caps: number[] = [];
    if (maxHeightRef.current != null) caps.push(maxHeightRef.current);
    if (cssMaxHeight > 0) caps.push(cssMaxHeight);
    const limit = caps.length > 0 ? Math.min(...caps) : null;

    const placeholder = el.placeholder;
    el.placeholder = "";
    el.style.height = "0px";
    el.style.minHeight = "0px";
    el.style.overflowY = "hidden";

    const content = el.scrollHeight + border;
    const next = Math.min(Math.max(content, minHeight), limit ?? Infinity);

    el.placeholder = placeholder;
    el.style.height = `${next}px`;
    el.style.minHeight = "";
    el.style.overflowY = limit != null && content > limit ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    resize();

    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, resize]);

  return ref;
}
