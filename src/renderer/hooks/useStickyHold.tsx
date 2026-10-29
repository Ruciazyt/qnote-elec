import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StickyHoldPayload } from "@shared/stickyNote";

/**
 * 长按一条记录 → 生成一张屏幕便签
 *
 * ## 交互怎么走
 *
 *   按下 → 立刻发 `sticky:hold-begin`，主进程开始计时
 *        → 按住满 1.2 秒，光标所在处出现一张便签，便签跟着光标走
 *   松手 → 发 `sticky:hold-end`，便签留在松手的位置
 *
 * 原来是"把记录拖出程序窗口"才生成便签 —— 那条路太难被用户发现，
 * 没人会想到要往外拖。现在按住 1.2 秒，按在哪就在哪生成。
 *
 * ## 为什么计时交给主进程
 *
 * 渲染层的计时会随窗口失焦、页面卡顿而漂移；主进程那边是墙钟时间，
 * 而且"便签出现在哪"本来就是主进程说了算（光标位置两边坐标系不同）。
 * 渲染层只负责画进度环，两边的进度条自然对得上。
 *
 * ## 为什么滚轮要取消长按
 *
 * 按着卡片滚滚轮是在翻列表，不是在长按。要是不取消，翻两下列表
 * 就会凭空多出一张便签。
 *
 * ## 为什么松手后还要拦一次 click
 *
 * 浏览器在 mouseup 之后还会补一个 click。按住 1.2 秒生成便签之后松手，
 * 这次 click 会落在卡片上（复制、删除等），等于"生成便签顺手改了剪贴板"。
 * 这里用时间戳而不是布尔量：click 事件紧跟 mouseup 触发，
 * 布尔量需要在事件之外复位，时间戳则天然只覆盖"刚刚"这一小段。
 */

/** 按住多久生成便签（毫秒）—— 与主进程的 HOLD_DURATION_MS 保持一致 */
const HOLD_DURATION_MS = 1200;
/** 松手后这段时间内到来的 click 一律拦掉（毫秒） */
const SUPPRESS_CLICK_MS = 200;
/** 进度环的周长（半径 19 的圆） */
const RING_CIRCUMFERENCE = 2 * Math.PI * 19;

export interface StickyHoldHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  onDoubleClickCapture: (event: React.MouseEvent) => void;
}

interface HoldStart {
  /** 光标当前位置 —— 进度环跟着它走 */
  x: number;
  y: number;
  payload: StickyHoldPayload;
  /** 按下的时刻 */
  startedAt: number;
}

interface HoldVisual {
  x: number;
  y: number;
  /** 0 ~ 1 */
  progress: number;
}

export function useStickyHold() {
  const [hold, setHold] = useState<HoldVisual | null>(null);
  const startRef = useRef<HoldStart | null>(null);
  /** 进度环的动画帧句柄 */
  const rafRef = useRef<number | null>(null);
  /** 这次长按是否已经满 1.2 秒（便签已经生成） */
  const completedRef = useRef(false);
  /** 长按刚结束的时间戳：这段时间内的 click / dblclick 一律吞掉 */
  const suppressUntilRef = useRef(0);

  /** 进度环推进 —— 用 rAF 才跟手，setInterval 会有肉眼可见的台阶 */
  const tick = useCallback(() => {
    const start = startRef.current;
    if (!start) return;
    const progress = Math.min(1, (Date.now() - start.startedAt) / HOLD_DURATION_MS);
    if (progress >= 1) {
      // 到点了：便签已经在光标处生成，进度环让位给真的便签
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
    // 位置由 rAF 循环统一刷新到 state，不必每挪一下就 setState
    start.x = event.clientX;
    start.y = event.clientY;
  }, []);

  const finishHold = useCallback(() => {
    const start = startRef.current;
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
      /* 主进程没准备好时忽略 */
    }
    // 只有真的生成了便签才拦 click —— 这次 click 是"长按松手"带出来的，
    // 不能让它顺手把记录复制了
    if (completedRef.current) {
      completedRef.current = false;
      suppressUntilRef.current = Date.now() + SUPPRESS_CLICK_MS;
    }
  }, [handleMove]);

  // 组件卸载时务必收尾：否则监听器会一直挂在 window 上
  useEffect(() => finishHold, [finishHold]);

  /** 拿到一张卡片的长按事件处理器 */
  const getHoldProps = useCallback(
    (payload: StickyHoldPayload): StickyHoldHandlers => ({
      onPointerDown: (event: React.PointerEvent) => {
        // 只认左键；右键/中键不参与
        if (event.button !== 0) return;
        // 按钮、输入框这些自带交互的元素不启动长按
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
        // 计时必须从"按下"起算，所以立刻通知主进程，别等什么阈值
        try {
          window.electron.stickyHoldBegin(payload);
        } catch {
          /* 主进程没准备好时忽略 */
        }
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", finishHold);
        window.addEventListener("pointercancel", finishHold);
        // 滚轮 = 在翻列表，不是在长按
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

  /** 长按进度环 —— 画在光标处，1.2 秒转满 */
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
