import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Search, ClipboardList } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface ClipboardItem {
  id: number;
  content: string;
  type: "text" | "image";
  time: string;
}

// window.electron 由 preload.ts 注入（通过 contextBridge）
// 类型定义见 src/renderer/electron.d.ts

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
  } catch {
    return dateStr;
  }
}

export function ClipboardPopup() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const history = await window.electron.popupGetClipboardHistory(20);
      setItems(history || []);
    } catch (err) {
      console.error("Failed to load clipboard history:", err);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current && items.length > 0) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex, items]);

  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    return item.content.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleCopy = useCallback(async (item: ClipboardItem) => {
    const result = await window.electron.popupCopyClipboardItem(item.id);
    if (result.success) {
      window.electron.closePopup();
    }
  }, []);

  const handleClose = useCallback(() => {
    window.electron.closePopup();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          void handleCopy(filteredItems[selectedIndex]);
        }
        return;
      }
    },
    [filteredItems, selectedIndex, handleCopy, handleClose]
  );

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  return (
    <div
      className="flex flex-col h-screen bg-background rounded-lg border border-border shadow-2xl overflow-hidden animate-popup-appear"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* 标题栏 */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card select-none" style={{ WebkitAppRegion: "drag" } as any}>
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          最近剪贴板
        </h2>
        <button
          onClick={handleClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
          style={{ WebkitAppRegion: "no-drag" } as any}
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="h-10 px-3 py-2 border-b border-border bg-card/50">
        <div className="relative h-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="搜索剪贴板..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-full pl-9 pr-3 text-sm bg-muted/40 rounded-lg border-none outline-none text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 transition-all duration-150"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent" ref={listRef}>
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 rounded-lg bg-card border border-border animate-pulse">
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
                <div className="mt-3 flex justify-between">
                  <div className="h-3 bg-muted rounded w-16" />
                </div>
              </div>
            ))}
          </>
        ) : filteredItems.length === 0 ? (
          searchQuery ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 animate-fade-in">
              <div className="relative mb-4">
                <div className="absolute inset-0 bg-primary/10 rounded-full blur-xl scale-75" />
                <div className="relative w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Search className="w-7 h-7 text-primary/60 animate-float" style={{ animationDuration: '3s' }} />
                </div>
              </div>
              <p className="text-sm font-medium text-foreground/70 mb-1">未找到匹配的记录</p>
              <p className="text-xs text-muted-foreground/70">尝试其他关键词</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 animate-fade-in">
              <p className="text-sm font-medium text-foreground/70 mb-1">暂无剪贴板记录</p>
              <p className="text-xs text-muted-foreground/70">开始复制内容即可自动记录</p>
            </div>
          )
        ) : (
          filteredItems.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.id}
                data-index={index}
                role="button"
                tabIndex={0}
                onClick={() => void handleCopy(item)}
                onKeyDown={(e) => {
                  // 行内的「复制」按钮自己处理回车/空格，这里只响应条目本身获得焦点的情况
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    // 弹窗根节点也监听回车去复制选中项，拦一下免得复制两次
                    e.stopPropagation();
                    void handleCopy(item);
                  }
                }}
                className={cn(
                  "group relative p-3 rounded-lg border transition-all duration-150 cursor-pointer",
                  "flex flex-col gap-2",
                  isSelected
                    ? "bg-primary/[0.07] border-primary/30 shadow-[0_4px_12px_hsl(var(--primary)/0.1)]"
                    : "bg-card border-border hover:border-primary/20 hover:shadow-sm"
                )}
              >
                {/* Left glow indicator — radiates behind selected item */}
                {isSelected && (
                  <div
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-[calc(100%-12px)] rounded-full shadow-[0_0_8px_hsl(var(--primary)/0.5),0_0_16px_hsl(var(--primary)/0.2)] pointer-events-none"
                  />
                )}
                {/* Left accent bar — keyboard selection indicator */}
                {isSelected && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-primary rounded-full shadow-[0_2px_6px_hsl(var(--primary)/0.3)]" />
                )}
                {item.type === "image" ? (
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="relative">
                      <img
                        src={item.content}
                        alt="剪贴板图片"
                        className="max-h-[160px] max-w-full w-auto rounded object-contain bg-muted/20"
                      />
                    </div>
                    <button
                      className={cn(
                        "text-xs transition-colors shrink-0 ml-auto",
                        isSelected
                          ? "text-primary opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => { e.stopPropagation(); void handleCopy(item); }}
                    >
                      复制
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 min-w-0">
                    <pre className={cn("flex-1 min-w-0 text-[13px] font-mono text-foreground whitespace-pre-wrap break-all", isSelected && "ml-0")}>
                      {item.content}
                    </pre>
                    <button
                      className={cn(
                        "text-xs transition-colors shrink-0",
                        isSelected
                          ? "text-primary opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => { e.stopPropagation(); void handleCopy(item); }}
                    >
                      复制
                    </button>
                  </div>
                )}
                <div className="text-xs text-muted-foreground flex items-center justify-between w-full pt-1 border-t border-border/40">
                  <span>{formatRelativeTime(item.time)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
