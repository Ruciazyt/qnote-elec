import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  ClipboardList,
  AppWindow,
  Image as ImageIcon,
  Type,
  Check,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useStickyHold } from "@/hooks/sticky/useStickyHold";
import { detectUrl } from "@/utils/clipboard/urlDetect";
import {
  CLIPBOARD_PANEL_ITEM_COUNT,
  CLIPBOARD_PANEL_BORDER,
  CLIPBOARD_PANEL_PADDING,
  CLIPBOARD_PANEL_HEADER_HEIGHT,
  CLIPBOARD_PANEL_CARD_GAP,
  CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH,
  CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT,
  CLIPBOARD_PANEL_SIDE_CARD_HEIGHT,
  CLIPBOARD_PANEL_SHADOW_PADDING,
  formatAccelerator,
  type ClipboardPanelPosition,
} from "@shared/clipboard/clipboardPanel";

interface ClipboardItem {
  id: number;
  content: string;
  type: "text" | "image";
  time: string;
}


function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "";
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
  } catch {
    return "";
  }
}

export function ClipboardPopup() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<ClipboardPanelPosition>("bottom");
  const [hotkey, setHotkey] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [copyToast, setCopyToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyToastTimer = useRef<number | null>(null);

  const { getHoldProps, holding, holdNode } = useStickyHold();

  const isBottom = position === "bottom";

  const panelVars = {
    "--card-w": `${CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH}px`,
    "--card-h": `${CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT}px`,
    "--side-card-h": `${CLIPBOARD_PANEL_SIDE_CARD_HEIGHT}px`,
  } as React.CSSProperties;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [history, pos, key] = await Promise.all([
        window.electron.popupGetClipboardHistory(CLIPBOARD_PANEL_ITEM_COUNT),
        window.electron.getClipboardPanelPosition(),
        window.electron.getClipboardPanelHotkey(),
      ]);
      setItems((history ?? []).slice(0, CLIPBOARD_PANEL_ITEM_COUNT));
      setPosition(pos.ok && pos.position ? pos.position : "bottom");
      setHotkey(key.ok && key.accelerator ? key.accelerator : "");
      setSelectedIndex(0);
    } catch (err) {
      console.error("加载剪贴板历史失败:", err);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      window.electron.onPopupRefresh(() => {
        void load();
      }),
    [load]
  );

  const showCopyToast = useCallback(
    (tone: "success" | "error", message: string, itemId: number | null) => {
      setCopyToast({ tone, message });
      setCopiedId(itemId);
      if (copyToastTimer.current !== null) {
        window.clearTimeout(copyToastTimer.current);
      }
      copyToastTimer.current = window.setTimeout(() => {
        setCopyToast(null);
        setCopiedId(null);
        copyToastTimer.current = null;
      }, 1600);
    },
    []
  );

  useEffect(
    () => () => {
      if (copyToastTimer.current !== null) {
        window.clearTimeout(copyToastTimer.current);
        copyToastTimer.current = null;
      }
    },
    []
  );

  const handleCopy = useCallback(
    async (item: ClipboardItem) => {
      try {
        const result = await window.electron.popupCopyClipboardItem(item.id);
        if (result.success) {
          showCopyToast("success", "已复制", item.id);
        } else {
          showCopyToast("error", result.error || "复制失败", null);
        }
      } catch (err) {
        console.error("复制剪贴板条目失败", err);
        showCopyToast("error", "复制失败", null);
      }
    },
    [showCopyToast]
  );

  const handleClose = useCallback(() => {
    window.electron.closePopup();
  }, []);

  const handleOpenApp = useCallback(() => {
    window.electron.showMainWindow();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) void handleCopy(item);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, handleCopy, handleClose]);

  const renderCard = (item: ClipboardItem, index: number) => {
    const isSelected = index === selectedIndex;
    const isLink = item.type === "text" && detectUrl(item.content) !== null;
    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        aria-label={`复制第 ${index + 1} 条记录`}
        onClick={() => void handleCopy(item)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            void handleCopy(item);
          }
        }}
        className={cn(
          "group relative flex flex-col rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer overflow-hidden",
          isBottom
            ? "h-[var(--card-h)] w-[var(--card-w)] shrink-0"
            : "h-[var(--side-card-h)] w-full shrink-0",
          isSelected
            ? "bg-primary/[0.08] border-primary/40 shadow-[0_4px_16px_hsl(var(--primary)/0.12)]"
            : "bg-card border-border/70 hover:border-primary/25",
          holding ? "opacity-60" : ""
        )}
        title="按住 1.2 秒即可变成屏幕便签"
        {...getHoldProps({ type: item.type, content: item.content })}
      >
        {}
        <div className="flex-1 min-h-0 overflow-hidden">
          {item.type === "image" ? (
            <img
              src={item.content}
              alt="剪贴板图片"
              className="h-full w-full object-contain bg-muted/20 rounded-md"
            />
          ) : (
            <pre
              className={cn(
                "font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all overflow-hidden",
                isBottom ? "line-clamp-5" : "line-clamp-2",
                isLink ? "text-link" : "text-foreground"
              )}>
              {item.content}
            </pre>
          )}
        </div>
        {
}
        {copiedId === item.id && (
          <div
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground shadow-md"
            title="已复制">
            <Check className="h-3 w-3" />
          </div>
        )}
        {}
        <div className="mt-2 pt-1.5 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
          <span className="tabular-nums">{index + 1}</span>
          {item.type === "image" ? (
            <ImageIcon className="h-3 w-3" />
          ) : (
            <Type className="h-3 w-3" />
          )}
          {item.type === "text" && (
            <span className="tabular-nums">{item.content.length} 个字符</span>
          )}
          <span className="ml-auto truncate">{formatRelativeTime(item.time)}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="h-screen w-screen"
      style={{ padding: CLIPBOARD_PANEL_SHADOW_PADDING }}>
      <div
        style={{ ...panelVars, borderWidth: CLIPBOARD_PANEL_BORDER }}
        className={cn(
          "h-full w-full flex flex-col overflow-hidden animate-popup-appear",
          "bg-background/95 backdrop-blur-xl border border-border shadow-2xl",
          isBottom ? "rounded-xl" : "rounded-2xl"
        )}>
        {}
        <div
          className="px-3 flex items-center justify-between border-b border-border/60 bg-card/70 shrink-0 select-none"
          style={{ height: CLIPBOARD_PANEL_HEADER_HEIGHT }}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" />
            剪贴板
            {hotkey && (
              <kbd className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
                {formatAccelerator(hotkey)}
              </kbd>
            )}
            {
}
            {copyToast && (
              <span
                className={cn(
                  "animate-copy-badge inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                  "text-[10px] font-medium leading-none",
                  copyToast.tone === "success"
                    ? "bg-success text-success-foreground"
                    : "bg-destructive text-destructive-foreground dark:bg-destructive/15 dark:text-destructive-foreground"
                )}
                role="status"
                aria-live="polite">
                {copyToast.tone === "success" ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <AlertCircle className="h-2.5 w-2.5" />
                )}
                {copyToast.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleOpenApp}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary-strong hover:bg-primary/10 transition-colors duration-150"
              aria-label="在应用中打开"
              title="在应用中打开">
              <AppWindow className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
              aria-label="关闭"
              title="关闭">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {}
        <div
          className={cn(
            "flex-1 min-h-0",
            isBottom
              ? "flex flex-row overflow-x-auto overflow-y-hidden"
              : "flex flex-col overflow-y-auto overflow-x-hidden"
          )}
          style={{
            padding: CLIPBOARD_PANEL_PADDING,
            gap: CLIPBOARD_PANEL_CARD_GAP,
          }}>
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-1 text-center">
              <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">还没有剪贴板记录</p>
              <p className="text-[11px] text-muted-foreground/70">
                复制点内容就会出现在这里
              </p>
            </div>
          ) : (
            items.map(renderCard)
          )}
        </div>
        {holdNode}
      </div>
    </div>
  );
}
