/**
 * 侧栏纵向分栏的拖拽分割线（上下两块之间那条横线）
 *
 * 与 PanelResizer 是一对：那边调**宽度**（左右分栏，线是竖的），
 * 这边调**高度**（上下分栏，线是横的）。两边都是 flex 兄弟节点真实占位 ——
 * 原因见 PanelResizer 顶部的注释：叠在别层上的分割线收不到鼠标事件。
 *
 * ## 值用比例，不用像素
 *
 * 上下两块共享同一个容器，窗口一变高，像素值立刻过时；
 * 比例则始终成立（60% 就是 60%）。默认的 6:4 这类需求也直接是比例。
 *
 * 拖拽用增量而不是绝对位置：容器高度在拖拽期间是恒定的（两块共享它，
 * 改的是它们内部的分配），所以「起始比例 ± 位移 / 容器高度」就够精确。
 *
 * ## 方向：往下拖 = 下块变矮
 *
 * 比例是**下块**占容器高度的比例，而分割线的位置由上块的高度决定
 * （= (1 - ratio) × 容器高）。分割线往下走，上块变高、下块变矮，
 * 所以拖拽与键盘的换算都要把位移**反过来**减 —— 符号搞反的话，
 * 分割线会跟指针往相反方向跑。
 *
 * ## 为什么 pointermove 要过 rAF
 *
 * pointermove 的频率跟着鼠标轮询率走，比屏幕刷新率高得多。
 * 每来一个事件就改一次比例，等于在一帧里反复改布局、反复走 React 渲染，
 * 而用户只看得到最后一个值。这里把事件攒到下一帧统一处理，一帧最多改一次。
 *
 * ## 拖拽期间要关掉过渡
 *
 * 上下两块的高度是 flex-basis，而它们身上挂着 150~220ms 的过渡。
 * 过渡开着的话，每一帧的新高度都会把过渡重新计时，面板永远慢半拍地
 * 追着指针跑 —— 这正是「分割线卡顿不跟手」的成因。
 * 拖拽开始/结束通过 onDraggingChange 通知外层，由外层把过渡关掉。
 */

import { useCallback, useRef, useState } from "react";
import { PANEL_RESIZER_WIDTH } from "./layout";

/** 键盘微调步长（比例）—— 和主流 IDE 的 split pane 一致 */
const KEYBOARD_STEP = 0.02;

interface PanelHeightResizerProps {
  /** 下块占容器高度的比例（0..1） */
  ratio: number;
  /** 允许的最小比例 */
  minRatio: number;
  /** 允许的最大比例 */
  maxRatio: number;
  /** 拖动 / 键盘调整时回调新比例 */
  onResize: (ratio: number) => void;
  /** 双击分割线 → 恢复默认比例 */
  onReset: () => void;
  /**
   * 禁用（收起态用）
   *
   * 下块收起时没有可调的高度 —— 拖了也看不出变化。
   * 这时把交互关掉，但那条分隔线要留着：它是上下两段的分界。
   */
  disabled?: boolean;
  /**
   * 拖拽开始 / 结束通知（可选）
   *
   * 上下两块的高度通常带 CSS 过渡（150~220ms）。拖拽时必须临时关掉 ——
   * 否则每一帧的新高度都会把过渡重新计时，面板永远慢半拍地追着指针跑，
   * 看起来就是「分割线卡顿、不跟手」。这条回调就是给外层开/关它的。
   *
   * 与 PanelResizer 的同名回调是一对：那边管宽度过渡（侧栏的 width），
   * 这边管高度过渡（flex-basis）。
   */
  onDraggingChange?: (dragging: boolean) => void;
}

/**
 * 上下分栏的分割线
 *
 * 容器是分割线的父节点 —— 上下两块共用的那列。
 * 比例是相对它算的，所以「下块 40%」就是下块占这一列的 40%。
 */
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
  /** 拖拽起点，闭包里读到的一定是按下那一刻的值 */
  const originRef = useRef({ pointerY: 0, ratio: 0, containerHeight: 0 });
  /**
   * 回调走 ref：它多半是调用方每渲染新建的函数，
   * 直接进依赖表会让下面的 move/stop 每次渲染都重绑一遍。
   */
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  /**
   * 拖拽的序号
   *
   * 松手时「过渡的恢复」要推迟一帧（见 stop 里的注释），
   * 用序号识别「这一轮的收尾」—— 万一马上又开始下一轮拖拽，
   * 上一轮的收尾回调不能把过渡关掉（不然过渡就永久没了）。
   */
  const dragSeqRef = useRef(0);

  const clampRatio = useCallback(
    (value: number) => Math.min(Math.max(value, minRatio), Math.max(minRatio, maxRatio)),
    [minRatio, maxRatio]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 只响应主键；右键/中键不应触发拖拽
      if (e.button !== 0) return;
      // 收起态没有可调的高度，拖了也看不出变化
      if (disabled) return;
      e.preventDefault();
      const container = (e.currentTarget as HTMLElement).parentElement;
      const containerHeight = container?.getBoundingClientRect().height ?? 0;
      // 量不到容器高度就别开了 —— 分母为 0 会把比例算成 NaN
      if (containerHeight <= 0) return;
      originRef.current = { pointerY: e.clientY, ratio, containerHeight };
      // 指针捕获失败不能中断整个拖拽：setPointerCapture 在指针已释放、
      // 元素已卸载时会抛 NotFoundError，一抛出去下面注册监听的几行就都执行不到。
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* 没有捕获也能拖，只是光标可能跑出分割线 */
      }
      setDragging(true);
      onDraggingChangeRef.current?.(true);
      const seq = (dragSeqRef.current += 1);

      /**
       * 拖拽期间的真实值
       *
       * latestY 记最新的指针位置，frame 记待处理的那一帧。
       * pointermove 只更新 latestY 并排一帧，真正的比例计算放在 rAF 里 ——
       * 一帧最多算一次，跟屏幕刷新率对齐。
       */
      let latestY = e.clientY;
      let frame = 0;

      const apply = (clientY: number) => {
        const origin = originRef.current;
        // 往下拖 = 分割线下移 = 上块变高、下块变矮
        //
        // 比例是「下块占容器高度的比例」，而下块的高度 = ratio * H，
        // 分割线的位置 = 上块的高度 = (1 - ratio) * H ——
        // 所以分割线下移时比例是**变小**的，符号要反过来。
        const delta = (clientY - origin.pointerY) / origin.containerHeight;
        onResize(clampRatio(origin.ratio - delta));
      };

      const move = (ev: PointerEvent) => {
        latestY = ev.clientY;
        // 这一帧已经排上了，等 rAF 统一处理
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(latestY);
        });
      };
      const stop = (ev: PointerEvent) => {
        // 还没处理的那一帧直接丢掉 —— 它算出来的值已经过时了
        if (frame !== 0) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        // 松手那一刻的坐标才是最终值：按它再算一次，
        // 分割线末端才会精确停在指针下面（而不是停在上一帧的位置）
        apply(ev.clientY);
        setDragging(false);
        // 过渡推迟一帧再打开。
        //
        // 刚 apply 的那一下高度可能和上一帧不同（松手位置比最后一次移动更靠下）。
        // 要是同一帧里既改了高度又打开了过渡，这一点位移会被当成动画播出来 ——
        // 表现是「鼠标都松开了，面板还自己滑了一下」。
        requestAnimationFrame(() => {
          // 已经开始了新的一轮拖拽：这一轮的过渡本来就该是关着的，别动它
          if (dragSeqRef.current !== seq) return;
          onDraggingChangeRef.current?.(false);
        });
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };

      // 监听挂在 window 上：分割线只有 7px，拖快了会瞬间掠出它自己的热区
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
      // 上下键的方向与分割线的位置一致：向上 = 分割线上移 = 下块变高
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
      // 角色取 slider：可拖拽的分割条要能被键盘操作，就必须是「可调节值的控件」。
      // separator 在 ARIA 里是结构角色（没有值、不可交互）。
      role="slider"
      aria-orientation="horizontal"
      aria-label="调整上下区域高度"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(minRatio * 100)}
      aria-valuemax={Math.round(maxRatio * 100)}
      aria-disabled={disabled || undefined}
      // 禁用时移出 Tab 序：不可用的控件不该占一个焦点位
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
        // 静止时透明：视觉分割靠中间那条 1px 线，这 7px 只做拖拽热区
        dragging ? "bg-primary" : "bg-transparent",
        // 禁用时不做悬停高亮 —— 那会让人以为还能拖
        disabled ? "" : "hover:bg-primary/60 focus-visible:bg-primary",
      ].join(" ")}
      style={{ height: PANEL_RESIZER_WIDTH }}
    >
      {/* 静止时就是一条分隔线；悬停/拖拽时变成品牌色，提示这里可以拖。
          颜色用 --divider：它就是「必须看得见的分栏线」那个 token */}
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
