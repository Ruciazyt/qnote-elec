import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  FileText,
  Sparkles,
} from "lucide-react";
import type { IslandDockEdge, IslandPage } from "@shared/island/island";

export const ISLAND_MODULES: Array<{
  page: IslandPage;
  label: string;
  icon: typeof CheckSquare;
}> = [
  { page: "todo", label: "待办", icon: CheckSquare },
  { page: "clipboard", label: "剪贴板", icon: Clipboard },
  { page: "notes", label: "笔记", icon: FileText },
  { page: "ai", label: "AI", icon: Sparkles },
];

export interface IslandCollapsedBarProps {
  pillRef: React.Ref<HTMLDivElement>;
  hidden: boolean;
  page: IslandPage;
  dockEdge: IslandDockEdge;
  hasContent: Record<IslandPage, boolean>;
  summary: string;
  summaryMuted: boolean;
  summaryCopyable: boolean;
  onCopySummary: () => void;
  onSelectPage: (page: IslandPage) => void;
  onToggle: () => void;
}

export function IslandCollapsedBar({
  pillRef,
  hidden,
  page,
  dockEdge,
  hasContent,
  summary,
  summaryMuted,
  summaryCopyable,
  onCopySummary,
  onSelectPage,
  onToggle,
}: IslandCollapsedBarProps) {
  const ToggleIcon =
    dockEdge === "left" ? ChevronLeft : dockEdge === "right" ? ChevronRight : ChevronUp;

  return (
    <div
      className="island-pill"
      data-testid="island-pill"
      data-hidden={hidden}
      ref={pillRef}
    >
      <div className="island-pill-modules">
        {ISLAND_MODULES.map((mod) => {
          const Icon = mod.icon;
          return (
            <button
              key={mod.page}
              type="button"
              className="island-module-btn"
              data-active={page === mod.page}
              title={mod.label}
              aria-label={mod.label}
              aria-current={page === mod.page ? "page" : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelectPage(mod.page);
              }}
            >
              <Icon size={15} strokeWidth={1.75} />
              {hasContent[mod.page] ? <span className="island-module-dot" /> : null}
            </button>
          );
        })}
      </div>

      {summaryCopyable ? (
        <button
          type="button"
          className="island-pill-summary"
          data-muted={summaryMuted}
          data-copyable="true"
          title={`${summary}（点击复制）`}
          aria-label="复制剪贴板内容"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCopySummary();
          }}
        >
          {summary}
        </button>
      ) : (
        <div className="island-pill-summary" data-muted={summaryMuted} title={summary}>
          {summary}
        </div>
      )}

      <button
        type="button"
        className="island-pill-toggle"
        title="展开"
        aria-label="展开灵动岛"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <ToggleIcon size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
