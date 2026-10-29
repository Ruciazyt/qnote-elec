import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, Trash2, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { bookmarkLabel } from "./BookmarkList";
import type { BookmarkRow } from "./types";

interface MenuState {
  x: number;
  y: number;
  item: BookmarkRow;
}

/**
 * 浏览器书签栏
 *
 * ## 为什么只靠插入一个 flex-shrink-0 节点就能生效
 *
 * 网页由主进程 WebContentsView 承载，是盖在 DOM 之上的原生层；它的边界来自
 * BrowserPage 里 containerRef 的 getBoundingClientRect()。所以本组件必须待在
 * containerRef **之外**，作为内容行之前的兄弟节点 —— 容器被挤下去，原生视图
 * 就会自动缩小、网页正常 reflow，不需要碰主进程的边界同步。
 *
 * ## 只在有收藏时占位
 *
 * 没有书签就整行不渲染，网页能拿到完整高度；一旦收藏第一条，这一行自动出现。
 */
export function BookmarkBar({
  onNavigate,
  revision,
}: {
  onNavigate: (url: string) => void;
  /** 收藏增删后由 BrowserPage 自增，触发本组件重新拉取 */
  revision: number;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<BookmarkRow[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await window.electron.browserBookmarkList());
    } catch (err) {
      console.error("读取书签失败", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 右键菜单：点别处 / 按 Esc 都关掉
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.("[data-bookmark-menu]")) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  if (items.length === 0) return null;

  const openMenuFor = (e: React.MouseEvent, item: BookmarkRow) => {
    e.preventDefault();
    // 贴近窗口右下角时向内收，避免菜单被裁掉
    const width = 176;
    const height = 132;
    const x = Math.min(e.clientX, window.innerWidth - width - 8);
    const y = Math.min(e.clientY, window.innerHeight - height - 8);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y), item });
  };

  const menuItemClass =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors";

  return (
    <>
      <div
        data-bookmark-bar
        className="flex-shrink-0 border-b border-border/60 bg-muted/10 px-2 py-1">
        <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.url}
              onClick={() => onNavigate(item.url)}
              onContextMenu={(e) => openMenuFor(e, item)}
              className="group flex shrink-0 items-center gap-1.5 rounded-md px-2 h-7 max-w-[180px] text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors">
              <Globe className="h-3 w-3 flex-shrink-0 opacity-50 group-hover:opacity-80" />
              <span className="truncate">{bookmarkLabel(item)}</span>
            </button>
          ))}
        </div>
      </div>

      {menu && (
        <div
          data-bookmark-menu
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[9999] w-44 rounded-lg border border-border/80 bg-background/95 backdrop-blur-sm p-1 shadow-[0_4px_20px_hsl(var(--foreground)/0.08),0_1px_4px_hsl(var(--foreground)/0.06)] ring-1 ring-border/60">
          <button
            type="button"
            role="menuitem"
            className={cn(menuItemClass, "text-foreground/90 hover:bg-accent")}
            onClick={() => {
              void window.electron.openExternal(menu.item.url);
              closeMenu();
            }}>
            <ExternalLink className="h-3 w-3 opacity-60" />
            用系统浏览器打开
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(menuItemClass, "text-foreground/90 hover:bg-accent")}
            onClick={() => {
              void navigator.clipboard
                .writeText(menu.item.url)
                .then(() => toast({ title: "链接已复制" }))
                .catch(() => toast({ title: "复制失败", variant: "destructive" }));
              closeMenu();
            }}>
            <Link2 className="h-3 w-3 opacity-60" />
            复制链接
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(menuItemClass, "text-destructive hover:bg-destructive/10")}
            onClick={async () => {
              closeMenu();
              await window.electron.browserBookmarkDelete(menu.item.id);
              await load();
            }}>
            <Trash2 className="h-3 w-3 opacity-60" />
            删除收藏
          </button>
        </div>
      )}
    </>
  );
}
