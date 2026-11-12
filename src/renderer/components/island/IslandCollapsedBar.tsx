import { CheckSquare, Clipboard, FileText, Sparkles, ChevronUp } from "lucide-react";
import type { IslandPage } from "@shared/island";

/** 岛上的四个模块 —— 图标 + 名字 */
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
  /** 胶囊元素 —— 主进程要按它量出收起态该有多宽 */
  pillRef: React.Ref<HTMLDivElement>;
  /** 展开时收起胶囊让位 */
  hidden: boolean;
  page: IslandPage;
  /** 各个模块现在有没有内容（有内容的挂个小圆点） */
  hasContent: Record<IslandPage, boolean>;
  /** 摘要文字 */
  summary: string;
  /** 摘要是不是「没有具体内容」的占位话术 */
  summaryMuted: boolean;
  onSelectPage: (page: IslandPage) => void;
  onToggle: () => void;
}

/**
 * 收起的胶囊
 *
 * 一行三段：左边四个模块入口（当前页签高亮，有内容的挂圆点）、
 * 中间一行摘要、右边一个展开箭头。
 */
export function IslandCollapsedBar({
  pillRef,
  hidden,
  page,
  hasContent,
  summary,
  summaryMuted,
  onSelectPage,
  onToggle,
}: IslandCollapsedBarProps) {
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
              // 按下不冒泡 —— 否则会顺带触发外层的拖动判定
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

      <div className="island-pill-summary" data-muted={summaryMuted} title={summary}>
        {summary}
      </div>

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
        <ChevronUp size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
