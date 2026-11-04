import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelResizer } from "@/components/panel/PanelResizer";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_COLLAPSED_WIDTH,
  PANEL_HEADER_PADDING_X,
  PANEL_RESIZER_WIDTH,
} from "@/components/panel/layout";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { usePanelWidth } from "@/hooks/usePanelWidth";
import { cn } from "@/lib/utils";

/**
 * 可收起、可伸缩的侧栏
 *
 * 「折叠 + 拖拽调宽」是几个页面共用的能力：笔记页的文件树、浏览器页的
 * 收藏夹/AI 侧栏、应用管理页的项目列表都要。这里把它收成一个组件，
 * 页面只管把自己的内容塞进来。
 *
 * ## 用法
 *
 * 父容器必须是 **flex 行**，侧栏与分割线是它的两个直接子节点：
 *
 * ```tsx
 * <div className="flex-1 min-h-0 flex">
 *   <ResizableSidebar storageKey="qnote-apps-list" title="项目" defaultWidth={320}>
 *     <MyList />
 *   </ResizableSidebar>
 *   <section className="flex-1 min-w-0">…</section>
 * </div>
 * ```
 *
 * 组件返回的是**片段**（侧栏 + 分割线），所以它自己占不了 flex 的一格 ——
 * 真正占位的是里面那个 aside。
 *
 * ## 动画
 *
 * 只有**宽度**参与过渡，内容自己淡出。为什么不整块淡：
 * 宽度变化时内容会被拉长/压扁，整块淡入淡出会让文字在拉伸中糊掉，
 * 而"侧栏正在收窄"这件事由宽度本身就说清楚了。
 *
 * 退场（收起）比入场（展开）快一档：收起是用户明确不要这块内容了，
 * 慢吞吞地缩回去会让人等；展开是用户要看到东西，值得铺开。
 *
 * `motion-reduce:transition-none` 给出系统级"减少动态效果"的退路：
 * 宽度直接跳到位，不做空间位移；内容淡出保留 —— 淡出是状态反馈，不是空间位移。
 */

/**
 * 收起后的轨道宽度 —— 里面只放折叠按钮
 *
 * 取值与折叠按钮的尺寸、锚点一起放在 panel/layout.ts，
 * 四个页面（笔记 / 题单 / 快捷方式 / 应用管理）共用同一套几何。
 */

export interface ResizableSidebarProps {
  /**
   * localStorage key 前缀
   *
   * 折叠态存 `${storageKey}-collapsed`，宽度存 `${storageKey}-width`。
   * 带上页面语义，不同页面的偏好才不会串。
   */
  storageKey: string;
  /** 面板标题（收起时隐藏） */
  title?: ReactNode;
  /** 标题右侧的操作区（收起时隐藏） */
  actions?: ReactNode;
  /** 展开时的默认宽度 */
  defaultWidth?: number;
  /** 允许的最小宽度 */
  minWidth?: number;
  /** 允许的最大宽度（静态上限） */
  maxWidth?: number;
  /** 主内容区至少要留多宽 —— 拖到上限时用它给主内容让路 */
  minContentWidth?: number;
  /** 侧栏在分栏的哪一侧 */
  side?: "left" | "right";
  /** 默认是否收起 */
  defaultCollapsed?: boolean;
  /** 外层 className */
  className?: string;
  /** 折叠态变化通知（父组件偶尔需要知道，比如据此收起别的面板） */
  onCollapsedChange?: (collapsed: boolean) => void;
  children: ReactNode;
}

export function ResizableSidebar({
  storageKey,
  title,
  actions,
  defaultWidth = 288,
  minWidth = 220,
  maxWidth = 560,
  minContentWidth = 360,
  side = "left",
  defaultCollapsed = false,
  className,
  onCollapsedChange,
  children,
}: ResizableSidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useCollapsedState(
    `${storageKey}-collapsed`,
    defaultCollapsed
  );
  /** 正在收起（而不是展开）—— 决定过渡时长：退场比入场快 */
  const [collapsing, setCollapsing] = useState(false);
  /** 拖拽中：临时关掉宽度的 CSS 过渡，否则侧栏会慢半拍地追着指针跑 */
  const [resizing, setResizing] = useState(false);

  const { width, setWidth, resetWidth } = usePanelWidth({
    storageKey: `${storageKey}-width`,
    defaultWidth,
    minWidth,
    maxWidth,
  });

  /**
   * 侧栏所在那一行（父级 flex 容器）的宽度
   *
   * 宽度上限要随窗口缩放重算，所以得量父级 —— 侧栏自己的宽度是结果，不是输入。
   */
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const row = asideRef.current?.parentElement;
    if (!row) return;
    const sync = () => {
      const next = row.clientWidth;
      // 数字没变时 setState 是 no-op，不会白白触发一次渲染
      setRowWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  /**
   * 宽度上限 —— 窗口变窄时要跟着降，给主内容区留够位置。
   *
   * 减去的两项：分割线自身占的 7px，以及主内容区的最小宽度。
   * 首次渲染 rowWidth 还是 0（ResizeObserver 还没回调），此时不设限，
   * 否则刚挂载就会拿 min 去钳出一个错误的上限。
   */
  const maxAllowedWidth = useMemo(() => {
    if (rowWidth <= 0) return maxWidth;
    const available = rowWidth - PANEL_RESIZER_WIDTH - minContentWidth;
    return Math.max(minWidth, Math.min(maxWidth, available));
  }, [rowWidth, maxWidth, minWidth, minContentWidth]);

  /**
   * 实际渲染宽度再钳一次。
   * 窗口缩小后上限会跟着变小，但持久化的宽度还停在大值上；
   * 不在这里收一下，主内容区就会被挤到 minContentWidth 以下。
   */
  const effectiveWidth = Math.min(width, maxAllowedWidth);

  const handleResize = useCallback(
    (next: number) => setWidth(next, maxAllowedWidth),
    [setWidth, maxAllowedWidth]
  );

  const handleReset = useCallback(
    () => resetWidth(maxAllowedWidth),
    [resetWidth, maxAllowedWidth]
  );

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    // next === true 表示正在收起 —— 退场用更短的时长
    setCollapsing(next);
    setCollapsed(next);
  }, [collapsed, setCollapsed]);

  // 折叠态变化通知 —— 回调走 ref，避免父组件每次渲染新建函数导致重复触发
  const onCollapsedChangeRef = useRef(onCollapsedChange);
  onCollapsedChangeRef.current = onCollapsedChange;
  useEffect(() => {
    onCollapsedChangeRef.current?.(collapsed);
  }, [collapsed]);

  /** 折叠按钮上的箭头：指向「展开的方向」，而不是「当前在哪」 */
  const chevron =
    side === "left"
      ? collapsed
        ? <ChevronRight className="h-4 w-4" />
        : <ChevronLeft className="h-4 w-4" />
      : collapsed
        ? <ChevronLeft className="h-4 w-4" />
        : <ChevronRight className="h-4 w-4" />;

  /** 收起时标题与操作区整体退场（宽度归零 + 淡出） */
  const hiddenWhenCollapsed =
    "w-0 overflow-hidden opacity-0 pointer-events-none transition-opacity duration-150";

  return (
    <>
      <aside
        ref={asideRef}
        style={{
          width: collapsed ? PANEL_COLLAPSED_WIDTH : effectiveWidth,
          // 拖拽期间关掉过渡：宽度过渡会让侧栏慢半拍地追着指针跑。
          // 用行内样式而不是再加一个 class：类之间谁赢取决于样式表里的先后，
          // 行内样式优先级最高，不会被 transition-[width] 之类的类盖掉。
          ...(resizing ? { transitionProperty: "none" } : null),
        }}
        className={cn(
          "flex h-full min-h-0 flex-col flex-shrink-0 overflow-hidden",
          side === "left" ? "border-r" : "border-l",
          "border-border/60",
          "transition-[width] ease-out motion-reduce:transition-none",
          collapsing ? "duration-150" : "duration-[220ms]",
          className
        )}>
        {/* 面板头：折叠按钮 + 标题 + 操作区

            横向内边距走行内样式（PANEL_COLLAPSED_BUTTON_INSET / PANEL_HEADER_PADDING_X），
            不用 Tailwind 的 px-/pl- 类：类名里的数字是写死的，
            跟共享常量各走各的，改了常量类名不会跟着变。

            折叠态两条硬规则（都在 panel/layout.ts 里写明了原因）：
            1. gap 必须是 0 —— 标题与操作区虽然宽度归零（w-0），gap 照样占位，
               会把按钮整体往左挤：按钮贴住轨道左缘，focus 描边左侧被轨道裁掉。
            2. 不能用 justify-center 居中 —— 轨道带 1px 分隔边框，内容盒 47px，
               居中会算出 7.5px 的小数偏移，左右留白不相等。
               改用固定左内边距把按钮锚在 8px，8+32+8=48，正好轨道正中。 */}
        <div
          style={{
            paddingLeft: collapsed ? PANEL_COLLAPSED_BUTTON_INSET : PANEL_HEADER_PADDING_X,
            paddingRight: collapsed ? 0 : PANEL_HEADER_PADDING_X,
          }}
          className={cn(
            "flex items-center h-10 flex-shrink-0",
            collapsed ? "gap-0" : "gap-2"
          )}>
          {/* 折叠按钮：32×32（PANEL_COLLAPSED_BUTTON_SIZE）。
              两态用同一个尺寸、同一行位置 —— 切换时只有面板宽度在动，
              按钮自己的盒子和 x 都不变。 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏" : "收起侧栏"}>
            {chevron}
          </Button>

          <div
            className={cn(
              "flex items-center gap-2 min-w-0 transition-opacity duration-150",
              collapsed ? hiddenWhenCollapsed : "flex-1 opacity-100"
            )}>
            {title}
          </div>

          {actions && (
            <div
              className={cn(
                "flex items-center gap-1 flex-shrink-0 transition-opacity duration-150",
                collapsed ? hiddenWhenCollapsed : "opacity-100"
              )}>
              {actions}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div
          className={cn(
            "flex-1 min-h-0 transition-opacity duration-150",
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          )}>
          {children}
        </div>
      </aside>

      {/* 分割线：收起时不渲染 —— 侧栏已经退化成一条按钮轨，
          再留个 7px 热区既没意义，也会挡住侧栏边缘的点击。 */}
      {!collapsed && (
        <PanelResizer
          width={effectiveWidth}
          minWidth={minWidth}
          maxWidth={maxAllowedWidth}
          onResize={handleResize}
          onReset={handleReset}
          onDraggingChange={setResizing}
          side={side}
          transparentAtRest
        />
      )}
    </>
  );
}
