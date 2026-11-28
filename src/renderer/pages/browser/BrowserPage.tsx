import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Globe,
  Loader2,
  ExternalLink,
  Star,
  PanelRight,
  Library,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/ui/use-toast";
import { setNativeViewCover } from "@/hooks/plugin/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { BrowserState, BrowserTabState } from "@/pages/browser/types";
import { useBookmarkState, isBookmarkable } from "@/pages/browser/BookmarkList";
import { BookmarkBar } from "@/pages/browser/BookmarkBar";
import { BrowserSidePanel } from "@/pages/browser/BrowserSidePanel";
import { PanelResizer } from "@/components/panel/PanelResizer";
import {
  BROWSER_MIN_WIDTH,
  PANEL_RESIZER_WIDTH,
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
} from "@/pages/browser/layout";
import { useBrowserSidePanel } from "@/hooks/browser/useBrowserSidePanel";
import { useRouteActive } from "@/hooks/system/useRouteActive";

const HOME_URL = "https://www.bing.com";
const SEARCH_PREFIX = "https://www.bing.com/search?q=";

export function normalizeUrl(raw: string): string {
  const input = raw.trim();
  if (!input) return HOME_URL;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (/^(about|data|mailto|tel):/i.test(input)) return input;

  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(input)) {
    return `http://${input}`;
  }

  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(input)) {
    return `https://${input}`;
  }

  return SEARCH_PREFIX + encodeURIComponent(input);
}

export default function BrowserPage() {
  const { toast } = useToast();

  const isRouteActive = useRouteActive("/browser");

  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const {
    view: sideView,
    setView: setSideView,
    width: sidePanelWidth,
    setWidth: setSidePanelWidth,
  } = useBrowserSidePanel();

  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const syncBoundsRef = useRef<() => void>(() => {});

  const maxPanelWidth = (() => {
    if (rowWidth <= 0) return SIDE_PANEL_MAX_WIDTH;
    const available = rowWidth - PANEL_RESIZER_WIDTH - BROWSER_MIN_WIDTH;
    return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, available));
  })();

  const effectivePanelWidth = Math.min(sidePanelWidth, maxPanelWidth);

  useEffect(() => {
    syncBoundsRef.current();
  }, [sideView, effectivePanelWidth]);

  const handleResizePanel = useCallback(
    (next: number) => setSidePanelWidth(next, maxPanelWidth),
    [setSidePanelWidth, maxPanelWidth]
  );

  const handleResetPanelWidth = useCallback(
    () => setSidePanelWidth(SIDE_PANEL_DEFAULT_WIDTH, maxPanelWidth),
    [setSidePanelWidth, maxPanelWidth]
  );

  const syncBounds = useCallback(() => {
    const target = containerRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    window.electron.browserSetBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);
  syncBoundsRef.current = syncBounds;

  const { saved: currentPageSaved, toggle: toggleBookmark, refresh: refreshBookmark } =
    useBookmarkState(activeTab?.url, activeTab?.title);

  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const bumpBookmarks = useCallback(() => {
    setBookmarkRevision((n) => n + 1);
    void refreshBookmark();
  }, [refreshBookmark]);

  const openBookmarkUrl = useCallback(
    (url: string) => {
      if (activeTab) window.electron.browserLoadUrl(activeTab.id, url);
      else void window.electron.browserCreateTab(url);
    },
    [activeTab]
  );

  const applyState = useCallback((state: BrowserState) => {
    setTabs(state.tabs);
    setActiveTabId(state.activeTabId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.electron.browserGetState();
        if (!cancelled) applyState(state);
      } catch (err) {
        console.error("初始化内嵌浏览器失败", err);
        toast({ title: "浏览器初始化失败", description: String(err), variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyState, toast]);

  useEffect(() => {
    const offTabs = window.electron.onBrowserTabsChanged(applyState);
    const offTab = window.electron.onBrowserTabUpdated((tab) => {
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? tab : t)));
    });
    const offError = window.electron.onBrowserLoadError(({ tabId, errorDescription }) => {
      if (tabId === activeTabIdRef.current) setLoadError(errorDescription);
    });
    return () => {
      offTabs();
      offTab();
      offError();
    };
  }, [applyState]);

  useEffect(() => {
    if (addressFocused) return;
    setAddress(activeTab?.url ?? "");
    setLoadError(null);
  }, [activeTab?.url, addressFocused]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleResize = () => {
      syncBoundsRef.current();
      const row = el.parentElement;
      if (row) {
        const next = row.clientWidth;
        setRowWidth((prev) => (prev === next ? prev : next));
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.body) {
      observer.observe(node);
      node = node.parentElement;
    }

    window.addEventListener("resize", handleResize);
    syncBoundsRef.current();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isRouteActive) {
      window.electron.browserSetVisible(false);
      setNativeViewCover(false);
      return;
    }
    syncBoundsRef.current();
    window.electron.browserSetVisible(true);
    setNativeViewCover(true);
  }, [isRouteActive]);

  const handleNavigate = useCallback(
    (action: "back" | "forward" | "reload" | "stop") => {
      if (!activeTab) return;
      window.electron.browserNavigate(activeTab.id, action);
    },
    [activeTab]
  );

  const handleAddressSubmit = useCallback(() => {
    if (!activeTab) return;
    const url = normalizeUrl(address);
    setAddress(url);
    setLoadError(null);
    window.electron.browserLoadUrl(activeTab.id, url);
  }, [activeTab, address]);

  const handleSelectTab = useCallback((tabId: string) => {
    window.electron.browserActivateTab(tabId);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const remaining = tabs.length - 1;
      window.electron.browserCloseTab(tabId);
      if (remaining <= 0) {
        setAddress("");
      }
    },
    [tabs.length]
  );

  const handleOpenExternal = useCallback(() => {
    if (!activeTab?.url) return;
    window.electron.openExternal(activeTab.url);
  }, [activeTab]);

  const handleToggleBookmark = useCallback(async () => {
    if (!activeTab?.url || !isBookmarkable(activeTab.url)) return;
    try {
      const nowSaved = await toggleBookmark();
      bumpBookmarks();
      toast({
        title: nowSaved ? "已收藏" : "已取消收藏",
        description: activeTab.title || activeTab.url,
      });
    } catch (err) {
      console.error("收藏操作失败", err);
      toast({
        title: "收藏操作失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [activeTab, toggleBookmark, toast, bumpBookmarks]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {}
      <div className="flex items-center gap-1 flex-shrink-0 border-b border-border/60 bg-muted/20 px-2 py-1">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                title={tab.url || tab.title}
                onClick={() => handleSelectTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTab(tab.id);
                  }
                }}
                className={`group flex items-center gap-1.5 shrink-0 max-w-[220px] h-8 px-2.5 rounded-md cursor-pointer transition-colors ${
                  isActive
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground/80"
                }`}>
                {tab.loading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0 opacity-60" />
                )}
                <span className="text-xs font-medium truncate">{tab.title || "新标签页"}</span>
                <button
                  type="button"
                  aria-label="关闭标签页"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className="shrink-0 rounded-sm p-0.5 opacity-0 group-hover:opacity-70 focus-within:opacity-100 hover:opacity-100 hover:bg-foreground/10 transition-opacity">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="新建标签页"
          aria-label="新建标签页"
          onClick={() => window.electron.browserCreateTab()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {}
      <div className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1.5 border-b border-border/60">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="后退"
          aria-label="后退"
          disabled={!activeTab?.canGoBack}
          onClick={() => handleNavigate("back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="前进"
          aria-label="前进"
          disabled={!activeTab?.canGoForward}
          onClick={() => handleNavigate("forward")}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={activeTab?.loading ? "停止" : "刷新"}
          aria-label={activeTab?.loading ? "停止" : "刷新"}
          onClick={() => handleNavigate(activeTab?.loading ? "stop" : "reload")}>
          {activeTab?.loading ? <X className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
        </Button>

        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => {
            setAddressFocused(true);
            e.target.select();
          }}
          onBlur={() => setAddressFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddressSubmit();
            if (e.key === "Escape") {
              setAddress(activeTab?.url ?? "");
              e.currentTarget.blur();
            }
          }}
          placeholder="输入网址或搜索内容"
          spellCheck={false}
          className="h-8 flex-1 text-xs"
        />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="侧栏（收藏夹 / AI）"
          aria-label="切换侧栏"
          aria-expanded={sideView !== null}
          onClick={() => setSideView((prev) => (prev === null ? "bookmarks" : null))}>
          <PanelRight
            className={cn("h-4 w-4", sideView !== null && "text-primary")}
          />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", sideView === "bookmarks" && "bg-accent text-accent-foreground")}
          title="收藏夹"
          aria-label="收藏夹"
          onClick={() => setSideView((prev) => (prev === "bookmarks" ? null : "bookmarks"))}>
          <Library className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", sideView === "ai" && "bg-accent text-accent-foreground")}
          title="AI 助手"
          aria-label="AI 助手"
          onClick={() => setSideView((prev) => (prev === "ai" ? null : "ai"))}>
          <Bot className={cn("h-4 w-4", sideView === "ai" && "text-primary")} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={currentPageSaved ? "取消收藏当前页" : "收藏当前页"}
          aria-label={currentPageSaved ? "取消收藏当前页" : "收藏当前页"}
          disabled={!activeTab?.url || !isBookmarkable(activeTab?.url ?? "")}
          onClick={handleToggleBookmark}>
          <Star
            className={cn("h-4 w-4", currentPageSaved && "fill-amber-400 text-amber-400")}
          />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="用系统默认浏览器打开"
          aria-label="用系统默认浏览器打开"
          disabled={!activeTab?.url}
          onClick={handleOpenExternal}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      {loadError && (
        <div className="flex-shrink-0 px-3 py-1.5 text-[11px] text-destructive bg-destructive/10 border-b border-destructive/20">
          页面加载失败：{loadError}
        </div>
      )}

      {
}
      <BookmarkBar revision={bookmarkRevision} onNavigate={openBookmarkUrl} />

      {}
      <div className="flex-1 min-h-0 flex">
        <div ref={containerRef} className="relative flex-1 min-w-0 bg-background overflow-hidden">
          {activeTab?.loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/20 overflow-hidden z-10 pointer-events-none">
              <div className="h-full w-1/3 bg-primary animate-pulse" />
            </div>
          )}
        </div>

        {sideView !== null && (
          <>
            {}
            <PanelResizer
              width={effectivePanelWidth}
              minWidth={SIDE_PANEL_MIN_WIDTH}
              maxWidth={maxPanelWidth}
              onResize={handleResizePanel}
              onReset={handleResetPanelWidth}
            />
            <BrowserSidePanel
              view={sideView}
              width={effectivePanelWidth}
              onViewChange={setSideView}
              onClose={() => setSideView(null)}
              onNavigate={openBookmarkUrl}
              onListChanged={bumpBookmarks}
            />
          </>
        )}
      </div>
    </div>
  );
}
