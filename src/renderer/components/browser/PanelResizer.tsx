/**
 * 侧栏拖拽分割线（类似 IDE / 浏览器的 split pane 分隔条）
 *
 * 为什么它是 flex 子节点而不是叠在侧栏左边缘的绝对定位元素：
 *   网页由主进程 WebContentsView 承载，是**盖在 DOM 之上的原生层**。
 *   压在原生视图上的 DOM 收不到鼠标事件，分割线只要有 1px 伸进网页区，
 *   那 1px 就点不动。做成真实占位的 flex 子节点就彻底绕开了。
 *
 * 为什么拖拽用增量而不是直接算绝对位置：
 *   拖拽期间侧栏宽度会一路带动网页区收缩，网页区的 DOM 尺寸每帧都在变。
 *   用「起始指针 + 起始宽度 + 位移」计算，不会因为中间态抖动而漂移。
 *
 * 谁在用：浏览器页的收藏夹/AI 侧栏（**在右**）、笔记页的文件树（**在左**）。
 * 两者分割线所处的侧缘不同，拖拽方向也就相反 —— 靠下面的 side 区分。
 */

import { useCallback, useRef, useState } from "react";
import { PANEL_RESIZER_WIDTH, clampPanelWidth } from "./layout";

/** 键盘微调步长 —— 和主流 IDE 的 split pane 一致 */
const KEYBOARD_STEP = 16;

interface PanelResizerProps {
  /** 当前侧栏宽度 */
  width: number;
  /** 当前可用区间（上限随窗口尺寸变化） */
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  /** 双击分割线 → 恢复默认宽度 */
  onReset: () => void;
  /**
   * 侧栏在分栏的哪一侧
   *
   * 它决定「指针往右拖」是加宽还是收窄 —— 两种几何是镜像的：
   *   - "right"（默认）：侧栏在右，分割线贴着它的**左**缘。往左拖 = 加宽。
   *   - "left"：侧栏在左，分割线贴着它的**右**缘。往右拖 = 加宽。
   *
   * 默认值取 "right" 保持浏览器页（侧栏在右）调用点零改动。
   */
  side?: "left" | "right";
  /**
   * 拖拽开始 / 结束通知（可选）
   *
   * 侧栏若给宽度加了 CSS transition，拖拽时必须临时关掉 ——
   * 否则侧栏会慢半拍地追着指针跑，手感发飘。这条回调就是给外层开/关它的。
   */
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * 静止时透明（可选）
   *
   * 默认休息态是 bg-border/50 的一条浅灰带：浏览器页的侧栏和网页是两个不同表面，
   * 需要这么一条带子把两者分开。
   *
   * 但笔记页两栏同在 --card 上，视觉分割由 .neu-divider-r 的拟态投影承担
   * （当初特意没画 1px 实线 —— 同色底上的实线看着像外框残留的接缝）。
   * 这时再叠一条 7px 实底就是自己打自己的脸，置 true 让它只做热区，
   * hover / 拖拽时的高亮照常。
   */
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
  /** 拖拽起点，闭包里读到的一定是按下那一刻的值 */
  const originRef = useRef({ pointerX: 0, width: 0 });
  /**
   * 回调走 ref：它多半是调用方每渲染新建的函数，
   * 直接进依赖表会让下面的 move/stop 每次渲染都重绑一遍。
   */
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 只响应主键；右键/中键不应触发拖拽
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      originRef.current = { pointerX: e.clientX, width };
      setDragging(true);
      onDraggingChangeRef.current?.(true);

      const move = (ev: PointerEvent) => {
        const origin = originRef.current;
        // 指针相对按下点的位移：侧栏在左就正着算，在右就反过来
        const delta =
          side === "left" ? ev.clientX - origin.pointerX : origin.pointerX - ev.clientX;
        onResize(clampPanelWidth(origin.width + delta, minWidth, maxWidth));
      };
      const stop = () => {
        setDragging(false);
        onDraggingChangeRef.current?.(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };

      // 监听挂在 window 上：分割线只有 7px，拖快了会瞬间掠出它自己的热区
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [width, minWidth, maxWidth, onResize, side]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // 方向键统一解释成「分割线往哪走」，而不是「侧栏怎么变」：
      //   侧栏在左 → 分割线右移就是加宽；在右 → 右移就是收窄。
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
      // 角色取 slider 而不是 separator：
      // 可拖拽的分割条要能被键盘操作，就必须是一个「可调节值的控件」。
      // separator 在 ARIA 里是结构角色（没有值、不可交互），
      // 可聚焦的 separator 虽然合法，但静态检查会判定
      // 「非交互元素上挂了键盘事件」；slider 才是这类控件的正位。
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
        // 这三支必须互斥、且任何时刻只出现一个普通背景类：
        // bg-transparent / bg-border/50 / bg-primary 同为单类选择器，
        // 并存时胜负取决于它们在生成样式表里的先后（.bg-primary 排在 .bg-transparent
        // 之后，于是拖拽高亮会被透明态吃掉）。hover: 那些带伪类、优先级更高，不受影响。
        dragging
          ? "bg-primary"
          : transparentAtRest
            ? "bg-transparent"
            : "bg-border/50",
        "hover:bg-primary/60 focus-visible:bg-primary",
      ].join(" ")}
      style={{ width: PANEL_RESIZER_WIDTH }}
    >
      {/* 悬停/拖拽时给一条更明显的竖线，提示这里可以拖 */}
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
