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
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { usePanelWidth } from "@/hooks/panel/usePanelWidth";
import { cn } from "@/lib/utils";



export interface ResizableSidebarProps {
  storageKey: string;
  title?: ReactNode;
  actions?: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  minContentWidth?: number;
  side?: "left" | "right";
  defaultCollapsed?: boolean;
  className?: string;
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
  const [collapsing, setCollapsing] = useState(false);
  const [resizing, setResizing] = useState(false);

  const { width, setWidth, resetWidth } = usePanelWidth({
    storageKey: `${storageKey}-width`,
    defaultWidth,
    minWidth,
    maxWidth,
  });

  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const row = asideRef.current?.parentElement;
    if (!row) return;
    const sync = () => {
      const next = row.clientWidth;
      setRowWidth((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const maxAllowedWidth = useMemo(() => {
    if (rowWidth <= 0) return maxWidth;
    const available = rowWidth - PANEL_RESIZER_WIDTH - minContentWidth;
    return Math.max(minWidth, Math.min(maxWidth, available));
  }, [rowWidth, maxWidth, minWidth, minContentWidth]);

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
    setCollapsing(next);
    setCollapsed(next);
  }, [collapsed, setCollapsed]);

  const onCollapsedChangeRef = useRef(onCollapsedChange);
  onCollapsedChangeRef.current = onCollapsedChange;
  useEffect(() => {
    onCollapsedChangeRef.current?.(collapsed);
  }, [collapsed]);

  const chevron =
    side === "left"
      ? collapsed
        ? <ChevronRight className="h-4 w-4" />
        : <ChevronLeft className="h-4 w-4" />
      : collapsed
        ? <ChevronLeft className="h-4 w-4" />
        : <ChevronRight className="h-4 w-4" />;

  const collapseTransition = "opacity 150ms, visibility 0s 150ms";
  const expandTransition = "opacity 150ms, visibility 0s 0ms";

  const hiddenWhenCollapsed =
    "w-0 overflow-hidden opacity-0 pointer-events-none invisible";
  const shownWhenExpanded = "opacity-100 visible";

  return (
    <>
      <aside
        ref={asideRef}
        style={{
          width: collapsed ? PANEL_COLLAPSED_WIDTH : effectiveWidth,
          ...(resizing ? { transitionProperty: "none" } : null),
          ...(collapsed
            ? {
                boxShadow:
                  side === "left"
                    ? "inset -1px 0 0 0 hsl(var(--border) / 0.6)"
                    : "inset 1px 0 0 0 hsl(var(--border) / 0.6)",
              }
            : null),
        }}
        className={cn(
          "flex h-full min-h-0 flex-col flex-shrink-0 overflow-hidden",
          collapsed
            ? null
            : side === "left"
              ? "border-r border-border/60"
              : "border-l border-border/60",
          "transition-[width] ease-out motion-reduce:transition-none",
          collapsing ? "duration-150" : "duration-panel",
          className
        )}>
        {
}
        <div
          style={{
            paddingLeft: collapsed ? PANEL_COLLAPSED_BUTTON_INSET : PANEL_HEADER_PADDING_X,
            paddingRight: collapsed ? 0 : PANEL_HEADER_PADDING_X,
          }}
          className={cn(
            "flex items-center h-12 pt-2 pb-2 flex-shrink-0",
            collapsed ? "gap-0" : "gap-2"
          )}>
          {
}
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
            style={{ transition: collapsed ? collapseTransition : expandTransition }}
            className={cn(
              "flex items-center gap-2 min-w-0",
              collapsed ? hiddenWhenCollapsed : cn("flex-1", shownWhenExpanded)
            )}>
            {title}
          </div>

          {actions && (
            <div
              style={{ transition: collapsed ? collapseTransition : expandTransition }}
              className={cn(
                "flex items-center gap-1 flex-shrink-0",
                collapsed ? hiddenWhenCollapsed : shownWhenExpanded
              )}>
              {actions}
            </div>
          )}
        </div>

        {}
        <div
          style={{ transition: collapsed ? collapseTransition : expandTransition }}
          className={cn(
            "flex-1 min-h-0",
            collapsed
              ? "opacity-0 pointer-events-none invisible"
              : "opacity-100 visible"
          )}>
          {children}
        </div>
      </aside>

      {
}
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
