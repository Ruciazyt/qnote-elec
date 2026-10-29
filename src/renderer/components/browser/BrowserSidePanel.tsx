import { Library, Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookmarkList } from "./BookmarkList";
import { AiSidePanel } from "./AiSidePanel";
import type { SidePanelView } from "./layout";

export type { SidePanelView } from "./layout";

interface BrowserSidePanelProps {
  view: SidePanelView;
  /** 宽度由分割线拖拽决定，由 BrowserPage 传进来 */
  width: number;
  onViewChange: (view: SidePanelView) => void;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onListChanged: () => void;
}

/**
 * 浏览器页侧栏（收藏夹 / AI）
 *
 * 它是普通 DOM，而网页由主进程 WebContentsView 承载、永远盖在 DOM 之上 ——
 * 所以父组件必须把它排进 flex 布局并同步收窄网页区域，侧栏才可见。
 * 宽度由左侧的 PanelResizer 拖拽决定。
 */
export function BrowserSidePanel({
  view,
  width,
  onViewChange,
  onClose,
  onNavigate,
  onListChanged,
}: BrowserSidePanelProps) {
  return (
    <aside
      className="flex flex-col h-full min-h-0 shrink-0 bg-muted/20 animate-in slide-in-from-right duration-200"
      style={{ width }}
      aria-label="浏览器侧栏">
      {/* 侧栏头部 — 视图切换 + 关闭 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50 flex-shrink-0">
        <button
          type="button"
          onClick={() => onViewChange("bookmarks")}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
            view === "bookmarks"
              ? "bg-background text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground/80"
          )}>
          <Library className="h-3.5 w-3.5" />
          收藏夹
        </button>
        <button
          type="button"
          onClick={() => onViewChange("ai")}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
            view === "ai"
              ? "bg-background text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground/80"
          )}>
          <Bot className={cn("h-3.5 w-3.5", view === "ai" && "text-primary")} />
          AI 助手
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="关闭侧栏"
          title="关闭侧栏"
          className="ml-auto rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0">
        {view === "bookmarks" ? (
          <BookmarkList onNavigate={onNavigate} onListChanged={onListChanged} />
        ) : (
          <AiSidePanel />
        )}
      </div>
    </aside>
  );
}
