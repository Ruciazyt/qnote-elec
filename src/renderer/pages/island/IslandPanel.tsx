import { ChevronDown } from "lucide-react";
import type { IslandPage } from "@shared/island/island";
import { ISLAND_MODULES } from "./IslandCollapsedBar";

interface IslandPanelProps {
  panelRef: React.Ref<HTMLDivElement>;
  hidden: boolean;
  page: IslandPage;
  counts: Partial<Record<IslandPage, number>>;
  onSelectPage: (page: IslandPage) => void;
  onCollapse: () => void;
  children: React.ReactNode;
}

export function IslandPanel({
  panelRef,
  hidden,
  page,
  counts,
  onSelectPage,
  onCollapse,
  children,
}: IslandPanelProps) {
  return (
    <div
      className="island-panel"
      data-testid="island-panel"
      data-hidden={hidden}
      ref={panelRef}
    >
      <div className="island-panel-header" data-island-drag-handle="true">
        {ISLAND_MODULES.map((mod) => {
          const Icon = mod.icon;
          const count = counts[mod.page];
          return (
            <button
              key={mod.page}
              type="button"
              className="island-tab"
              data-active={page === mod.page}
              aria-current={page === mod.page ? "page" : undefined}
              onClick={() => onSelectPage(mod.page)}
            >
              <Icon size={13} strokeWidth={1.75} />
              {mod.label}
              {typeof count === "number" && count > 0 ? (
                <span className="island-tab-count">{count}</span>
              ) : null}
            </button>
          );
        })}
        <div className="island-panel-header-spacer" />
        <button
          type="button"
          className="island-header-btn"
          title="收起"
          aria-label="收起灵动岛"
          onClick={onCollapse}
        >
          <ChevronDown size={15} strokeWidth={1.75} />
        </button>
      </div>
      <div className="island-panel-body">{children}</div>
    </div>
  );
}
