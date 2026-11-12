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
 * 为什么 pointermove 要过 rAF：
 *   pointermove 的触发频率跟着鼠标轮询率走（常见 125~1000Hz），
 *   比屏幕刷新率高得多。每一帧都调 onResize 就是在做无用功 ——
 *   每次调用都会走一遍 React 渲染 + 落盘，而用户根本看不见中间那些值。
 *   这里把事件攒到下一帧再统一处理，一帧最多改一次宽度。
 *
 * 谁在用：浏览器页的收藏夹/AI 侧栏（**在右**）、笔记页的文件树（**在左**）、
 * 应用管理页的项目列表（**在左**）。侧栏所处的侧缘不同，拖拽方向也就相反 ——
 * 靠下面的 side 区分。
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
   * 但笔记页两栏同在 --card 上，视觉分割由侧栏右缘那条 1px 语义边框承担
   * （展开态 border-r border-border/60，折叠态画等色 inset 阴影）。
   * 竖向分栏统一走 --border 这一个 token，明暗两套主题下是同一种线；
   * 拟态投影只留给横向那条（.neu-divider-b，工具栏下缘）。
   * 应用管理页同理：侧栏自己带那条边框，再叠一条 7px 实底就是自己打自己的脸。
   * 这时置 true 让它只做热区，hover / 拖拽时的高亮照常。
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

  /**
   * 拖拽的序号
   *
   * 松手时「过渡的恢复」要推迟一帧（见 stop 里的注释），
   * 用序号识别「这一轮的收尾」—— 万一马上又开始下一轮拖拽，
   * 上一轮的收尾回调不能把过渡关掉（不然过渡就永久没了）。
   */
  const dragSeqRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 只响应主键；右键/中键不应触发拖拽
      if (e.button !== 0) return;
      e.preventDefault();
      originRef.current = { pointerX: e.clientX, width };
      // 指针捕获失败（指针已释放、元素已卸载）不能中断整个拖拽：
      // setPointerCapture 在这些情况下会抛 NotFoundError，
      // 一旦抛出去，下面注册 window 监听的几行就都执行不到了 ——
      // 表现是「按下去没反应」，而且没有任何报错。
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        // 忽略：没有捕获也能拖，只是光标可能跑出分割线
      }
      setDragging(true);
      onDraggingChangeRef.current?.(true);
      const seq = (dragSeqRef.current += 1);

      /**
       * 拖拽期间的真实值
       *
       * latestX 记的是最新的指针位置，frame 记的是待处理的那一帧。
       * pointermove 只负责更新 latestX 并排一帧；真正的宽度计算放在
       * rAF 回调里 —— 一帧最多算一次，跟屏幕刷新率对齐。
       */
      let latestX = e.clientX;
      let frame = 0;

      const apply = (clientX: number) => {
        const origin = originRef.current;
        // 指针相对按下点的位移：侧栏在左就正着算，在右就反过来
        const delta =
          side === "left" ? clientX - origin.pointerX : origin.pointerX - clientX;
        onResize(clampPanelWidth(origin.width + delta, minWidth, maxWidth));
      };

      const move = (ev: PointerEvent) => {
        latestX = ev.clientX;
        // 这一帧已经排上了，等 rAF 统一处理
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(latestX);
        });
      };
      const stop = (ev: PointerEvent) => {
        // 还没处理的那一帧直接丢掉 —— 它算出来的值已经过时了
        if (frame !== 0) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        // 松手那一刻的坐标才是最终值：按它再算一次，
        // 侧栏末端才会精确停在指针下面（而不是停在上一帧的位置）
        apply(ev.clientX);
        setDragging(false);
        // 过渡推迟一帧再打开。
        //
        // 刚 apply 的那一下几何可能和上一帧不同（松手位置比最后一次移动更靠后）。
        // 要是同一帧里既改了宽度又打开了过渡，这一点位移会被当成动画播出来 ——
        // 表现是「鼠标都松开了，侧栏还自己滑了一下」。
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
