import { type KeyboardEvent } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Trash2, X, Search, ClipboardList } from "lucide-react";

interface ClipboardToolbarProps {
  searchKeyword: string;
  onSearchChange: (value: string) => void;
  onDeleteAll: () => void;
  clearDisabled?: boolean;
  resultCount?: number;
  totalCount?: number;
}

export function ClipboardToolbar({
  searchKeyword,
  onSearchChange,
  onDeleteAll,
  clearDisabled = false,
  resultCount,
  totalCount,
}: ClipboardToolbarProps) {
  const isSearchActive = searchKeyword.length > 0;
  const showResultCount = isSearchActive && resultCount !== undefined && resultCount > 0;
  const showTotalCount = !isSearchActive && totalCount !== undefined && totalCount > 0;

  return (
    <div className="px-4 pt-4 pb-3 neu-divider-b">
      <div className="flex items-center gap-4 h-10">
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 search-wrapper-focus-pop">
            {}
            <div
              className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200 ${
                isSearchActive ? "text-primary/70" : "text-muted-foreground"
              }`}>
              <Search className="h-4 w-4" />
            </div>
            <Input
              type="text"
              placeholder="搜索记录..."
              value={searchKeyword}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Escape") {
                  onSearchChange("");
                }
              }}
              className={`pl-9 pr-8 search-input-hover search-input-focus transition-all duration-150 ${
                isSearchActive ? "search-input-active" : ""
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              aria-label="搜索剪贴板记录"
            />
            {
}
            <button
              onClick={() => onSearchChange("")}
              onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSearchChange("");
                }
              }}
              tabIndex={isSearchActive ? 0 : -1}
              aria-label="清除搜索"
              title="清除搜索（Esc / 回车 / 点击）"
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground bg-muted/50 border border-transparent
                hover:border-muted-foreground/20 hover:scale-110 hover:text-foreground
                active:scale-90
                focus:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:border-primary/40
                transition-all duration-150 group search-clear-btn cursor-pointer ${isSearchActive ? "visible search-clear-btn-pop-in" : ""}`}>
              {}
              <X className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-180" />
            </button>
          </div>

          {
}
          {showResultCount && (
            <div key={`result-badge-${searchKeyword}-${resultCount}`} className="flex-shrink-0 result-badge-pop">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
                bg-primary/10 text-primary-strong border border-primary/20 dark:bg-primary/15 dark:text-primary-strong dark:border-primary/30
                tracking-wide transition-all duration-200">
                {resultCount} 条结果
              </span>
            </div>
          )}

          {
}
          {showTotalCount && (
            <div key={`total-badge-${totalCount}`} className="flex-shrink-0 toolbar-total-badge">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
                bg-muted/70 text-muted-foreground border border-border/60
                dark:bg-muted/50 dark:text-muted-foreground/80 dark:border-border/50
                tracking-wide transition-all duration-200">
                <ClipboardList className="h-2.5 w-2.5 opacity-70" />
                {totalCount} 条记录
              </span>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onDeleteAll}
            disabled={clearDisabled}
            title={clearDisabled ? "暂无记录可清空" : "清空所有记录"}
            aria-label={clearDisabled ? "暂无记录可清空" : "清空所有记录"}
            className={`whitespace-nowrap transition-colors duration-150 ${
              clearDisabled
                ? "opacity-50 cursor-not-allowed"
                : "btn-delete-enabled dialog-confirm-btn"
            }`}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            清空记录
          </Button>
        </div>
      </div>
    </div>
  );
}
