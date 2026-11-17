import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StickyHoldPayload } from "@shared/sticky/stickyNote";


const HOLD_DURATION_MS = 1200;
const SUPPRESS_CLICK_MS = 200;
const RING_CIRCUMFERENCE = 2 * Math.PI * 19;

export interface StickyHoldHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  onDoubleClickCapture: (event: React.MouseEvent) => void;
}

interface HoldStart {
  x: number;
  y: number;
  payload: StickyHoldPayload;
  startedAt: number;
}

interface HoldVisual {
  x: number;
  y: number;
  progress: number;
}

export function useStickyHold() {
  const [hold, setHold] = useState<HoldVisual | null>(null);
  const startRef = useRef<HoldStart | null>(null);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const suppressUntilRef = useRef(0);

  const tick = useCallback(() => {
    const start = startRef.current;
    if (!start) return;
    const progress = Math.min(1, (Date.now() - start.startedAt) / HOLD_DURATION_MS);
    if (progress >= 1) {
      completedRef.current = true;
      setHold(null);
      return;
    }
    setHold({ x: start.x, y: start.y, progress });
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const handleMove = useCallback((event: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    start.x = event.clientX;
    start.y = event.clientY;
  }, []);

  const finishHold = useCallback(() => {
    startRef.current = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finishHold);
    window.removeEventListener("pointercancel", finishHold);
    window.removeEventListener("wheel", finishHold);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHold(null);
    try {
      window.electron.stickyHoldEnd();
    } catch {
    }
    if (completedRef.current) {
      completedRef.current = false;
      suppressUntilRef.current = Date.now() + SUPPRESS_CLICK_MS;
    }
  }, [handleMove]);

  useEffect(() => finishHold, [finishHold]);

  const getHoldProps = useCallback(
    (payload: StickyHoldPayload): StickyHoldHandlers => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select, [data-no-sticky-hold]")) {
          return;
        }
        completedRef.current = false;
        startRef.current = {
          x: event.clientX,
          y: event.clientY,
          payload,
          startedAt: Date.now(),
        };
        setHold({ x: event.clientX, y: event.clientY, progress: 0 });
        try {
          window.electron.stickyHoldBegin(payload);
        } catch {
        }
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", finishHold);
        window.addEventListener("pointercancel", finishHold);
        window.addEventListener("wheel", finishHold, { passive: true });
        rafRef.current = requestAnimationFrame(tick);
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (Date.now() < suppressUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onDoubleClickCapture: (event: React.MouseEvent) => {
        if (Date.now() < suppressUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    }),
    [handleMove, finishHold, tick]
  );

  const holdNode =
    hold && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed z-[9999] pointer-events-none select-none"
            style={{ left: hold.x, top: hold.y }}>
            <svg
              width="46"
              height="46"
              viewBox="0 0 46 46"
              className="block -translate-x-1/2 -translate-y-1/2">
              <circle
                cx="23"
                cy="23"
                r="19"
                fill="none"
                stroke="hsl(var(--foreground) / 0.18)"
                strokeWidth="3"
              />
              <circle
                cx="23"
                cy="23"
                r="19"
                fill="none"
                stroke="hsl(var(--foreground) / 0.9)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - hold.progress)}
                transform="rotate(-90 23 23)"
              />
            </svg>
          </div>,
          document.body
        )
      : null;

  return { getHoldProps, holding: hold !== null, holdNode };
}
