import { ChevronDown } from "lucide-react";
import type { IslandPage } from "@shared/island";
import { ISLAND_MODULES } from "./IslandCollapsedBar";

interface IslandPanelProps {
  /** 面板元素 —— 渲染层靠它判断鼠标有没有落在卡片上 */
  panelRef: React.Ref<HTMLDivElement>;
  /** 收起时面板淡出并停止接收点击 */
  hidden: boolean;
  page: IslandPage;
  /** 各页签上要显示的计数（没有就不显示） */
  counts: Partial<Record<IslandPage, number>>;
  onSelectPage: (page: IslandPage) => void;
  onCollapse: () => void;
  children: React.ReactNode;
}

/**
 * 展开的面板
 *
 * 顶部一行页签，下面是内容。页签行同时是拖动手柄 ——
 * 展开状态下只有这一行能拖着岛走，面板里的列表滚动不该带着窗口跑。
 */
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
