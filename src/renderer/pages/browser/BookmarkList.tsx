import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Trash2, Loader2, Library } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { BookmarkRow } from "./types";

export function isBookmarkable(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function bookmarkLabel(item: BookmarkRow): string {
  const title = item.title?.trim();
  if (title && !/^https?:\/\//i.test(title)) return title;
  return prettyHost(item.url);
}

export function BookmarkList({
  onNavigate,
  onListChanged,
}: {
  onNavigate: (url: string) => void;
  onListChanged: () => void;
}) {
  const [items, setItems] = useState<BookmarkRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await window.electron.browserBookmarkList());
    } catch (err) {
      console.error("读取书签失败", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(
      (item) =>
        (item.title ?? "").toLowerCase().includes(kw) || item.url.toLowerCase().includes(kw)
    );
  }, [items, keyword]);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.electron.browserBookmarkDelete(id);
    await load();
    onListChanged();
  };

  const handleOpenExternal = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.electron.openExternal(url);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-border/60 flex-shrink-0">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索收藏"
          spellCheck={false}
          className="h-7 text-xs"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground/70">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Library className="h-5 w-5 text-muted-foreground/30" />
            <p className="text-[11px] text-muted-foreground/70">
              {keyword.trim() ? "没有匹配的收藏" : "还没有收藏"}
            </p>
            {!keyword.trim() && (
              <p className="text-[10px] text-muted-foreground/50">点工具栏的星标收藏当前页</p>
            )}
          </div>
        ) : (
          filtered.map((item) => {
            const label = bookmarkLabel(item);
            const hasTitle = label !== prettyHost(item.url);
            return (
              <div
                key={item.id}
                onClick={() => onNavigate(item.url)}
                role="button"
                tabIndex={0}
                aria-label={`打开 ${label}`}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNavigate(item.url);
                  }
                }}
                title={item.url}
                className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate text-foreground/90">
                    {label}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {hasTitle ? prettyHost(item.url) : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleOpenExternal(item.url, e)}
                  aria-label="用系统浏览器打开"
                  title="用系统浏览器打开"
                  className="shrink-0 rounded-sm p-1 text-muted-foreground/0 group-hover:text-muted-foreground/70 focus-visible:text-muted-foreground hover:!text-foreground hover:bg-foreground/10 transition-all">
                  <ExternalLink className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(item.id, e)}
                  aria-label="删除收藏"
                  title="删除收藏"
                  className="shrink-0 rounded-sm p-1 text-muted-foreground/0 group-hover:text-muted-foreground/70 focus-visible:text-muted-foreground hover:!text-destructive hover:bg-foreground/10 transition-all">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function useBookmarkState(url: string | undefined, title?: string | null) {
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    if (!url || !isBookmarkable(url)) {
      setSaved(false);
      return;
    }
    try {
      setSaved(await window.electron.browserBookmarkIsSaved(url));
    } catch (err) {
      console.error("查询收藏状态失败", err);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (!url || !isBookmarkable(url)) return false;
    if (saved) {
      await window.electron.browserBookmarkRemove(url);
      setSaved(false);
      return false;
    }
    const cleanTitle = title?.trim();
    const res = await window.electron.browserBookmarkAdd(url, cleanTitle || undefined);
    setSaved(res.success);
    return res.success;
  }, [url, title, saved]);

  return { saved, toggle, refresh };
}
