import { type KeyboardEvent } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Trash2, X, Search, ClipboardList } from "lucide-react";

interface ClipboardToolbarProps {
  searchKeyword: string;
  onSearchChange: (value: string) => void;
  onDeleteAll: () => void;
  clearDisabled?: boolean;
  /** Total count of results currently displayed (shown only when searching) */
  resultCount?: number;
  /** Total record count — shown as a muted badge when not searching and records exist */
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
  // Result badge: shown when actively searching with keyword AND results exist.
  // Hidden when 0 results — the dedicated "未找到匹配的记录" empty state handles that case
  const showResultCount = isSearchActive && resultCount !== undefined && resultCount > 0;
  // Total count badge: shown when NOT searching but records exist
  // Gives users immediate awareness of how many records they have collected.
  const showTotalCount = !isSearchActive && totalCount !== undefined && totalCount > 0;

  return (
    // 工具栏与下方列表之间不再用 1px 边框硬切，改用单侧柔光投影
    <div className="px-4 pt-4 pb-3 neu-divider-b">
      <div className="flex items-center gap-4 h-10">
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 search-wrapper-focus-pop">
            {/* Search icon — primary tint when active, muted when idle */}
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
              }`}
              aria-label="搜索剪贴板记录"
            />
            {/*
              Bug fix (ui: search clear button always-visible ring):
              Previously `visible` was hardcoded in className unconditionally — the button
              always received a visible ring even when no search was active. Now `visible`
              is only added when isSearchActive=true, so the button is fully hidden (opacity:0,
              scale:0.5 via .search-clear-btn base styles) when idle and smoothly appears
              when the user types a keyword.

              Enhancement: Added search-clear-btn-pop-in class alongside
              `visible` to trigger a spring pop-in animation (scale 0.5→1.1→0.97→1.0) the
              first time the button appears. This makes the button "pop" into existence with
              a satisfying overshoot instead of just fading in. The animation fires once on
              class add, then settles — subsequent keystrokes keep scale at 1.0 via .visible.

              Enhancement: Clear button title now also documents the Esc
              keyboard shortcut, making the keyboard-first workflow discoverable.
            */}
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
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/60 bg-muted/50 border border-transparent
                hover:border-muted-foreground/20 hover:scale-110 hover:text-foreground
                active:scale-90
                focus:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:border-primary/40
                transition-all duration-150 group search-clear-btn cursor-pointer ${isSearchActive ? "visible search-clear-btn-pop-in" : ""}`}>
              {/* X icon rotates 180° on hover — clearer "dismiss" affordance */}
              <X className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-180" />
            </button>
          </div>

          {/* Search result count badge — spring pop entrance animation
              Replaces simple fade-in with a spring scale overshoot (0.85 → 1.08 → 1.0)
              that makes the badge feel alive and responsive when it first appears.
              Only shown when resultCount > 0 — "0 条结果" is hidden so it doesn't
              compete with the dedicated "未找到匹配的记录" empty state. */}
          {showResultCount && (
            <div key={`result-badge-${searchKeyword}-${resultCount}`} className="flex-shrink-0 result-badge-pop">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
                bg-primary/10 text-primary/80 border border-primary/20 dark:bg-primary/15 dark:text-primary/85 dark:border-primary/30
                tracking-wide transition-all duration-200">
                {resultCount} 条结果
              </span>
            </div>
          )}

          {/* Total record count badge — muted pill shown when not searching but records exist
              Gives users immediate awareness of how many records they have collected.
              Uses the same pill style as result badge but in a muted/low-key palette so it
              doesn't compete with the search UI. Subtle scale-in animation on mount. */}
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
                // dialog-confirm-btn adds spring hover (lift + shadow) on top of the persistent red tint
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
