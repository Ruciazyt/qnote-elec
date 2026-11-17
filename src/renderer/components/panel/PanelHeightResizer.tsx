
import { useCallback, useRef, useState } from "react";
import { PANEL_RESIZER_WIDTH } from "./layout";

const KEYBOARD_STEP = 0.02;

interface PanelHeightResizerProps {
  ratio: number;
  minRatio: number;
  maxRatio: number;
  onResize: (ratio: number) => void;
  onReset: () => void;
  disabled?: boolean;
  onDraggingChange?: (dragging: boolean) => void;
}

export function PanelHeightResizer({
  ratio,
  minRatio,
  maxRatio,
  onResize,
  onReset,
  disabled = false,
  onDraggingChange,
}: PanelHeightResizerProps) {
  const [dragging, setDragging] = useState(false);
  const originRef = useRef({ pointerY: 0, ratio: 0, containerHeight: 0 });
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const dragSeqRef = useRef(0);

  const clampRatio = useCallback(
    (value: number) => Math.min(Math.max(value, minRatio), Math.max(minRatio, maxRatio)),
    [minRatio, maxRatio]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (disabled) return;
      e.preventDefault();
      const container = (e.currentTarget as HTMLElement).parentElement;
      const containerHeight = container?.getBoundingClientRect().height ?? 0;
      if (containerHeight <= 0) return;
      originRef.current = { pointerY: e.clientY, ratio, containerHeight };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
      }
      setDragging(true);
      onDraggingChangeRef.current?.(true);
      const seq = (dragSeqRef.current += 1);

      let latestY = e.clientY;
      let frame = 0;

      const apply = (clientY: number) => {
        const origin = originRef.current;
        const delta = (clientY - origin.pointerY) / origin.containerHeight;
        onResize(clampRatio(origin.ratio - delta));
      };

      const move = (ev: PointerEvent) => {
        latestY = ev.clientY;
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(latestY);
        });
      };
      const stop = (ev: PointerEvent) => {
        if (frame !== 0) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        apply(ev.clientY);
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
    [ratio, onResize, clampRatio, disabled]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next: number | null = null;
      if (e.key === "ArrowUp") next = ratio + KEYBOARD_STEP;
      else if (e.key === "ArrowDown") next = ratio - KEYBOARD_STEP;
      else if (e.key === "Home") next = maxRatio;
      else if (e.key === "End") next = minRatio;
      else if (e.key === "Enter") {
        e.preventDefault();
        onReset();
        return;
      }
      if (next === null) return;
      e.preventDefault();
      onResize(clampRatio(next));
    },
    [ratio, minRatio, maxRatio, onResize, onReset, clampRatio, disabled]
  );

  return (
    <div
      role="slider"
      aria-orientation="horizontal"
      aria-label="调整上下区域高度"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(minRatio * 100)}
      aria-valuemax={Math.round(maxRatio * 100)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? "外部文件夹已收起" : "拖动调整高度，双击恢复默认比例"}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={disabled ? undefined : onReset}
      data-dragging={dragging || undefined}
      className={[
        "group relative shrink-0 touch-none outline-none",
        disabled ? "cursor-default" : "cursor-row-resize",
        "transition-colors duration-150",
        dragging ? "bg-primary" : "bg-transparent",
        disabled ? "" : "hover:bg-primary/60 focus-visible:bg-primary",
      ].join(" ")}
      style={{ height: PANEL_RESIZER_WIDTH }}
    >
      {
}
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2",
          dragging
            ? "bg-primary-foreground/80"
            : disabled
              ? "bg-[hsl(var(--divider))]"
              : "bg-[hsl(var(--divider))] group-hover:bg-primary/60",
          "transition-colors duration-150",
        ].join(" ")}
      />
    </div>
  );
}
