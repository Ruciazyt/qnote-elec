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
import { useToast } from "@/hooks/use-toast";
import { setNativeViewCover } from "@/hooks/useNativeViewCover";
import { cn } from "@/lib/utils";
import type { BrowserState, BrowserTabState } from "@/components/browser/types";
import { BookmarkList, useBookmarkState, isBookmarkable } from "@/components/browser/BookmarkList";
import { BookmarkBar } from "@/components/browser/BookmarkBar";
import { BrowserSidePanel } from "@/components/browser/BrowserSidePanel";
import { PanelResizer } from "@/components/browser/PanelResizer";
import {
  BROWSER_MIN_WIDTH,
  PANEL_RESIZER_WIDTH,
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
} from "@/components/browser/layout";
import { useBrowserSidePanel } from "@/hooks/useBrowserSidePanel";
import { useRouteActive } from "@/hooks/useRouteActive";

const HOME_URL = "https://www.bing.com";
const SEARCH_PREFIX = "https://www.bing.com/search?q=";

/**
 * 地址栏输入归一化 —— 和主流浏览器一致的输入直觉：
 * - 完整协议      → 原样使用
 * - localhost / IP → 补 http://
 * - 域名          → 补 https://
 * - 其它          → 当搜索词
 */
export function normalizeUrl(raw: string): string {
  const input = raw.trim();
  if (!input) return HOME_URL;

  // 已带协议（http/https 等）直接透传，交给主进程判定安全性
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  // 单层协议无 //，如 about:blank
  if (/^(about|data|mailto|tel):/i.test(input)) return input;

  // localhost / IPv4 / 带端口
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(input)) {
    return `http://${input}`;
  }

  // 域名 —— 末段必须是 2 位以上纯字母，否则 "3.14"、"1.2" 这类会被误判成域名
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(input)) {
    return `https://${input}`;
  }

  return SEARCH_PREFIX + encodeURIComponent(input);
}

export default function BrowserPage() {
  const { toast } = useToast();

  /** keep-alive 下页面切走后仍挂载，原生视图显隐据此判断 */
  const isRouteActive = useRouteActive("/browser");

  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  /** 地址栏聚焦期间不跟随页面 URL 变化，否则用户输入会被冲掉 */
  const [addressFocused, setAddressFocused] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 网页区所在 flex 行的可用宽度 —— 侧栏上限由它推导，随窗口变化 */
  const [rowWidth, setRowWidth] = useState(0);
  /** null = 侧栏收起。视图与宽度都持久化 —— 切页面回来不用重新点开、不用重新拖 */
  const {
    view: sideView,
    setView: setSideView,
    width: sidePanelWidth,
    setWidth: setSidePanelWidth,
    resetWidth: resetSidePanelWidth,
  } = useBrowserSidePanel();

  const containerRef = useRef<HTMLDivElement>(null);
  /** activeTabId 的 ref 副本 —— 让事件回调读到最新值而不必重建订阅 */
  const activeTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const syncBoundsRef = useRef<() => void>(() => {});

  /**
   * 侧栏宽度上限 —— 窗口变窄时要跟着降，给网页留够 BROWSER_MIN_WIDTH。
   * 拖拽过程中实时算，否则窗口较小时会把网页挤到看不见。
   *
   * rowWidth 由 ResizeObserver 写入 state，窗口缩放时会重算（而不是只在首次渲染算一次）。
   */
  const maxPanelWidth = (() => {
    if (rowWidth <= 0) return SIDE_PANEL_MAX_WIDTH;
    const available = rowWidth - PANEL_RESIZER_WIDTH - BROWSER_MIN_WIDTH;
    return Math.max(SIDE_PANEL_MIN_WIDTH, Math.min(SIDE_PANEL_MAX_WIDTH, available));
  })();

  /**
   * 实际渲染宽度再钳一次。
   * 窗口缩小后，上限会跟着变小，但持久化的宽度还停在大值上；
   * 不在这里收一下，网页就会被挤到 BROWSER_MIN_WIDTH 以下。
   */
  const effectivePanelWidth = Math.min(sidePanelWidth, maxPanelWidth);

  /**
   * 侧栏展开/收起、宽度变化后立刻重算一次网页区域尺寸。
   * flex 布局会在侧栏出现或变宽时自动收窄网页区，ResizeObserver 也会触发，
   * 但这里显式补一次，避免展开/拖拽瞬间出现一帧错位。
   */
  useEffect(() => {
    syncBoundsRef.current();
    // 依赖用 effectivePanelWidth 而不是 sidePanelWidth：窗口缩小时上限会跟着降，
    // 实际渲染宽度变了但 state 没变，这里必须一起覆盖到。
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
    // 网页区是侧栏的 flex 兄弟节点 —— rect 已经天然排除了侧栏占位，
    // 这里直接用即可。早期版本额外加了一次侧栏宽度，导致视图被多推出去一整段。
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

  /**
   * 书签栏的刷新信号
   *
   * 书签栏和右侧收藏夹面板共用同一份数据。工具栏星标切换、侧栏里删除之后自增
   * 计数器让书签栏重拉 —— 用计数器而不是让两处共享一份 state，是因为侧栏是
   * 按需挂载的（收起时不渲染），共享状态会让两边互相牵制。
   */
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const bumpBookmarks = useCallback(() => {
    setBookmarkRevision((n) => n + 1);
    // 刷新书签列表是附带动作，不阻塞当前交互，显式 void 忽略
    void refreshBookmark();
  }, [refreshBookmark]);

  /**
   * 打开书签地址：有活动标签就复用，没有就新开一个。
   * 书签栏和收藏夹面板共用，避免"没有标签时点了没反应"的死路。
   */
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

  // 初始化 —— 主进程保证至少存在一个标签页
  useEffect(() => {
    let cancelled = false;
    // 内部已 try/catch，不会 reject；取消标记只防卸载后写 state，显式 void 忽略返回值
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

  // 订阅主进程状态推送
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

  // 地址栏跟随当前页面
  useEffect(() => {
    if (addressFocused) return;
    setAddress(activeTab?.url ?? "");
    setLoadError(null);
  }, [activeTab?.url, addressFocused]);

  /**
   * 尺寸同步
   * WebContentsView 盖在渲染进程之上，位置对不上就会错位或挡住整个窗口
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /**
     * 同步视图边界，并顺带记录可用总宽度。
     * 记宽度是为了让"侧栏宽度上限"跟着窗口变化重算 —— ResizeObserver
     * 和 syncBounds 都只做副作用，不会触发重渲染，不存进 state 的话
     * 用户缩小窗口后上限还是旧值，侧栏会把网页挤没。
     */
    const handleResize = () => {
      syncBoundsRef.current();
      const row = el.parentElement;
      if (row) {
        const next = row.clientWidth;
        // 数字没变时 setState 是 no-op，不会白白触发一次渲染
        setRowWidth((prev) => (prev === next ? prev : next));
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    // 侧边栏折叠只改父级宽度、不改容器尺寸，所以把祖先链一并观察
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.body) {
      observer.observe(node);
      node = node.parentElement;
    }

    window.addEventListener("resize", handleResize);
    syncBounds();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  /**
   * 原生视图的显隐跟随**路由**，而不是挂载 / 卸载
   *
   * 页面改成 keep-alive（切走不卸载）后，卸载清理不会再执行。
   * 如果显隐还挂在卸载上，切走浏览器页时 WebContentsView 会一直
   * 盖在整个窗口上 —— 整个应用看起来像卡死。
   */
  useEffect(() => {
    if (!isRouteActive) {
      window.electron.browserSetVisible(false);
      setNativeViewCover(false);
      return;
    }
    // 重新显示前先把最新尺寸同步给原生视图（隐藏期间容器尺寸为 0）
    syncBoundsRef.current();
    window.electron.browserSetVisible(true);
    // 让全局 AI 浮框在浏览器页期间让位（原生视图盖不住 z-index）
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
        // 关掉最后一个会由主进程自动补一个新标签，地址栏重置
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
    const nowSaved = await toggleBookmark();
    // 书签栏和收藏夹都要跟着变
    bumpBookmarks();
    toast({
      title: nowSaved ? "已收藏" : "已取消收藏",
      description: activeTab.title || activeTab.url,
    });
  }, [activeTab, toggleBookmark, toast, bumpBookmarks]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 页内标签栏 */}
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
                  className="shrink-0 rounded-sm p-0.5 opacity-0 group-hover:opacity-70 hover:opacity-100 hover:bg-foreground/10 transition-opacity">
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

      {/* 工具栏 */}
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

      {/* 书签栏：只在有收藏时渲染（组件内部为空即返回 null）。
          必须待在 containerRef 之外、排在内容行之前 —— 原生视图边界读的是
          containerRef 的 rect，插入这一行后网页区被挤下去，视图自动缩小并 reflow。*/}
      <BookmarkBar revision={bookmarkRevision} onNavigate={openBookmarkUrl} />

      {/* 侧栏在右：网页区是 flex 兄弟节点，rect 已天然排开侧栏宽度 */}
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
            {/* 分割线真实占位 → 网页区被压缩而不是被盖住；网页会正常 reflow */}
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
