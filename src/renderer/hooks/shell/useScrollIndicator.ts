import { useEffect } from "react";

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

    window.addEventListener("scroll", activate, { passive: true, capture: true });
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
