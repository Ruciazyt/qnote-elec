import { useEffect } from "react";

/**
 * useScrollIndicator — 监听全应用滚动，短暂给 <html> 加 .is-scrolling 类
 * 用于触发"滚动时显示滚动条，闲置时隐藏"的视觉效果
 *
 * 实现要点：
 * - 监听 window 的 scroll 事件（capture 阶段捕获所有冒泡上来的滚动）
 * - 也监听 wheel + touchmove 作为兜底（部分场景 scroll 不冒泡）
 * - 800ms 内无滚动则移除类
 */
export function useScrollIndicator(idleMs: number = 800): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const html = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const activate = () => {
      html.classList.add("is-scrolling");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        html.classList.remove("is-scrolling");
      }, idleMs);
    };

    // capture: true 让 scroll 事件能跨元素冒泡捕获
    window.addEventListener("scroll", activate, { passive: true, capture: true });
    // 兜底：滚轮 + 触摸事件确保一定触发
    window.addEventListener("wheel", activate, { passive: true, capture: true });
    window.addEventListener("touchmove", activate, { passive: true, capture: true });

    return () => {
      window.removeEventListener("scroll", activate, { capture: true } as EventListenerOptions);
      window.removeEventListener("wheel", activate, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchmove", activate, { capture: true } as EventListenerOptions);
      if (timer) clearTimeout(timer);
      html.classList.remove("is-scrolling");
    };
  }, [idleMs]);
}
