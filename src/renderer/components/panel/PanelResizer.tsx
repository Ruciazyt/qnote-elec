
import { useCallback, useRef, useState } from "react";
import { PANEL_RESIZER_WIDTH, clampPanelWidth } from "./layout";

const KEYBOARD_STEP = 16;

interface PanelResizerProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onReset: () => void;
  side?: "left" | "right";
  onDraggingChange?: (dragging: boolean) => void;
  transparentAtRest?: boolean;
}

export function PanelResizer({
  width,
  minWidth,
  maxWidth,
  onResize,
  onReset,
  onDraggingChange,
  side = "right",
  transparentAtRest = false,
}: PanelResizerProps) {
  const [dragging, setDragging] = useState(false);
  const originRef = useRef({ pointerX: 0, width: 0 });
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const dragSeqRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      originRef.current = { pointerX: e.clientX, width };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
      }
      setDragging(true);
      onDraggingChangeRef.current?.(true);
      const seq = (dragSeqRef.current += 1);

      let latestX = e.clientX;
      let frame = 0;

      const apply = (clientX: number) => {
        const origin = originRef.current;
        const delta =
          side === "left" ? clientX - origin.pointerX : origin.pointerX - clientX;
        onResize(clampPanelWidth(origin.width + delta, minWidth, maxWidth));
      };

      const move = (ev: PointerEvent) => {
        latestX = ev.clientX;
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(latestX);
        });
      };
      const stop = (ev: PointerEvent) => {
        if (frame !== 0) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        apply(ev.clientX);
        setDragging(false);
        requestAnimationFrame(() => {
          if (dragSeqRef.current !== seq) return;
          onDraggingChangeRef.current?.(false);
        });
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [width, minWidth, maxWidth, onResize, side]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = side === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP;
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = width - step;
      else if (e.key === "ArrowRight") next = width + step;
      else if (e.key === "Home") next = minWidth;
      else if (e.key === "End") next = maxWidth;
      else if (e.key === "Enter") {
        e.preventDefault();
        onReset();
        return;
      }
      if (next === null) return;
      e.preventDefault();
      onResize(clampPanelWidth(next, minWidth, maxWidth));
    },
    [width, minWidth, maxWidth, onResize, onReset, side]
  );

  return (
    <div
      role="slider"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      title="拖动调整侧栏宽度，双击恢复默认"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
      data-dragging={dragging || undefined}
      className={[
        "group relative shrink-0 touch-none outline-none cursor-col-resize",
        "transition-colors duration-150",
        dragging
          ? "bg-primary"
          : transparentAtRest
            ? "bg-transparent"
            : "bg-border/50",
        "hover:bg-primary/60 focus-visible:bg-primary",
      ].join(" ")}
      style={{ width: PANEL_RESIZER_WIDTH }}
    >
      {}
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          dragging ? "bg-primary-foreground/80" : "bg-primary/0 group-hover:bg-primary/60",
          "transition-colors duration-150",
        ].join(" ")}
      />
    </div>
  );
}
