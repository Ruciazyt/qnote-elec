import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StickyDragPayload } from "@shared/stickyNote";

/**
 * 把一条记录「拖出」程序窗口 → 变成屏幕便签
 *
 * ## 交互怎么走
 *
 *   按下 → 移动超过 6px → 进入拖拽态（渲染层发 `sticky:drag-begin`）
 *        → 主进程盯着光标，一旦光标离开源窗口就撕下便签
 *   松手 → 渲染层发 `sticky:drag-end`，便签留在松手的位置
 *
 * ## 为什么阈值要有 6px
 *
 * 手抖一下（点一下卡片）不该触发拖拽。可反过来阈值太大也不行：
 * 用户按住卡片往窗口外甩，甩过头了才越阈值，便签就"跟不上"了。
 * 6px 是两者之间比较稳的值 —— 超过它才算"在拖"，没超过就还算"在点"。
 *
 * ## 为什么松手后还要拦一次 click
 *
 * 浏览器在 mouseup 之后还会补一个 click。要是这次点击落在"复制""删除"
 * 这些按钮上，拖一次就顺手删了一条记录 —— 这种误伤必须挡掉。
 * 这里用时间戳而不是布尔量：click 事件紧跟 mouseup 触发，
 * 布尔量需要在事件之外复位，时间戳则天然只覆盖"刚刚"这一小段。
 */

/** 超过这个位移才算"在拖" */
const DRAG_THRESHOLD = 6;
/** 松手后这段时间内到来的 click 一律拦掉（毫秒） */
const SUPPRESS_CLICK_MS = 200;

export interface StickyDragHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  onDoubleClickCapture: (event: React.MouseEvent) => void;
}

interface DragStart {
  startX: number;
  startY: number;
  payload: StickyDragPayload;
  active: boolean;
}

interface GhostState {
  x: number;
  y: number;
  payload: StickyDragPayload;
}

export function useStickyDrag() {
  const [dragging, setDragging] = useState(false);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const startRef = useRef<DragStart | null>(null);
  /** 拖拽刚结束的时间戳：这段时间内的 click / dblclick 一律吞掉 */
  const suppressUntilRef = useRef(0);

  const handleMove = useCallback((event: PointerEvent) => {
    const start = startRef.current;
    if (!start) return;

    if (!start.active) {
      const dx = event.clientX - start.startX;
      const dy = event.clientY - start.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      start.active = true;
      setDragging(true);
      // 拖动中别让浏览器选中文本
      document.body.style.userSelect = "none";
      try {
        window.electron.stickyDragBegin(start.payload);
      } catch {
        /* 主进程没准备好时忽略 */
      }
    }

    setGhost({ x: event.clientX, y: event.clientY, payload: start.payload });
  }, []);

  const finishDrag = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    document.body.style.userSelect = "";

    if (start?.active) {
      suppressUntilRef.current = Date.now() + SUPPRESS_CLICK_MS;
      try {
        window.electron.stickyDragEnd();
      } catch {
        /* 主进程没准备好时忽略 */
      }
    }
    setDragging(false);
    setGhost(null);
  }, [handleMove]);

  // 组件卸载时务必收尾：否则监听器会一直挂在 window 上
  useEffect(() => finishDrag, [finishDrag]);

  /** 拿到一张卡片的拖拽事件处理器 */
  const getDragProps = useCallback(
    (payload: StickyDragPayload): StickyDragHandlers => ({
      onPointerDown: (event: React.PointerEvent) => {
        // 只认左键；右键/中键不参与拖拽
        if (event.button !== 0) return;
        // 按钮、输入框这些自带交互的元素不启动拖拽
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, textarea, select, [data-no-sticky-drag]")) {
          return;
        }
        startRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          payload,
          active: false,
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", finishDrag);
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
    [handleMove, finishDrag]
  );

  /** 拖拽时跟着光标走的预览 */
  const ghostNode =
    ghost &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed z-[9999] pointer-events-none select-none"
            style={{ left: ghost.x + 14, top: ghost.y + 14 }}>
            <div className="max-w-[260px] max-h-[180px] overflow-hidden rounded-lg border border-black/10 bg-amber-100/95 px-2.5 py-2 shadow-lg rotate-[-2deg] opacity-90">
              {ghost.payload.type === "image" ? (
                <img
                  src={ghost.payload.content}
                  alt=""
                  className="max-h-[150px] max-w-[240px] rounded object-contain"
                  draggable={false}
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-stone-800 line-clamp-6">
                  {ghost.payload.content}
                </pre>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return { getDragProps, dragging, ghostNode };
}
