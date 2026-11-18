import { useEffect } from "react";

export function useScrollIndicator(idleMs: number = 800): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active: Element | null = null;

    const deactivate = () => {
      if (!active) return;
      active.classList.remove("is-scrolling");
      active = null;
    };

    const activate = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : document.documentElement;
      if (active !== element) {
        deactivate();
        element.classList.add("is-scrolling");
        active = element;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(deactivate, idleMs);
    };

    const onScroll = (event: Event) => activate(event.target);

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      if (timer) clearTimeout(timer);
      deactivate();
    };
  }, [idleMs]);
}
