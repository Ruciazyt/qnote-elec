import { Boxes, FolderPlus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppProject, AppRuntimeState } from "@shared/appTypes";

/**
 * 左侧项目列表（内容部分）
 *
 * 它只管列表本身 —— 外框、宽度、折叠由 ResizableSidebar 提供，
 * 搜索词也交给上层持有：标题旁边要显示「筛选中 / 总数」，
 * 计数得由父组件算，所以关键词不能藏在这里。
 *
 * ## 为什么每条是两行
 *
 * 只放项目名的话，同一个列表里放三个都叫 "web" 的项目就分不清谁是谁 ——
 * 路径才是区分它们的关键。所以第二行给路径，而且只显示末两段：
 * 开头那截（`D:\lenovo\gsc\`）对每个项目都一样，占地方不提供信息。
 *
 * ## 状态为什么用小圆点而不是图标
 *
 * 一个大图标在 40 多条列表里会变成一片图标噪声。状态用 2px 的圆点，
 * 颜色承载信息（绿=可用 / 琥珀=未配置 / 红=清单有误），
 * 扫一眼就能挑出有问题的那几条。
 */
interface AppProjectListProps {
  /** 已按关键词过滤的项目 */
  projects: AppProject[];
  /** 搜索词 */
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  runtime: Record<number, AppRuntimeState>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onImport: () => void;
}

/** 状态点配色 —— 与详情区的状态徽标同源 */
const DOT_CLASS = {
  ready: "bg-emerald-500",
  "missing-manifest": "bg-amber-500",
  "invalid-manifest": "bg-destructive",
} as const;

/**
 * 只显示路径的末两段
 *
 * `D:\lenovo\gsc\ichain-dev-console` → `…\gsc\ichain-dev-console`
 */
function tailPath(fullPath: string, segments = 2): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) return fullPath;
  return `…\\${parts.slice(-segments).join("\\")}`;
}

export function AppProjectList({
  projects,
  keyword,
  onKeywordChange,
  runtime,
  selectedId,
  onSelect,
  onImport,
}: AppProjectListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 搜索
          左内边距跟头部（折叠按钮）、下面的列表统一用 8px（PANEL_HEADER_PADDING_X），
          面板里所有内容共用同一条左缘。 */}
      <div className="px-2 pb-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="搜索项目"
            className="h-7 pl-7 text-xs"
            aria-label="搜索项目"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {projects.length === 0 ? (
          <div className="py-10 px-3 text-center">
            <div className="relative w-11 h-11 mx-auto mb-3 rounded-xl bg-primary/[0.06] border border-primary/15 flex items-center justify-center">
              <Boxes className="h-5 w-5 text-primary/50" />
            </div>
            <p className="text-sm text-muted-foreground/70 mb-1">
              {keyword.trim() ? "没有匹配的项目" : "还没有导入项目"}
            </p>
            {!keyword.trim() && (
              <>
                <p className="text-xs text-muted-foreground/60 leading-relaxed mb-3">
                  导入一个带 qnote.json 的文件夹
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs btn-hover"
                  onClick={onImport}>
                  <FolderPlus className="h-3.5 w-3.5 mr-1" />
                  导入文件夹
                </Button>
              </>
            )}
          </div>
        ) : (
          projects.map((project) => {
            const rt = runtime[project.id];
            const running = rt?.status === "running" || rt?.status === "starting";
            const isSelected = project.id === selectedId;

            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project.id)}
                title={project.path}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "relative w-full text-left rounded-md pl-2.5 pr-2 py-1.5 transition-colors",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50"
                )}>
                {/* 选中标记 —— 单独一根竖条，而不是给整块上品牌色。
                    整块铺色在列表里太抢眼（40 个项目就是 40 块色斑），
                    一根 2px 的竖条既够用，又把"当前在编辑哪个"说清楚了。 */}
                {isSelected && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full flex-shrink-0",
                      DOT_CLASS[project.status]
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-medium truncate flex-1">{project.name}</span>
                  {running && (
                    <span className="text-[10px] text-emerald-500 flex-shrink-0 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      运行中
                    </span>
                  )}
                </div>
                <div className="mt-0.5 pl-3.5 text-[10.5px] font-mono text-muted-foreground/60 truncate">
                  {tailPath(project.path)}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
