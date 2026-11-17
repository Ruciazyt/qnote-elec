import { Boxes, FolderPlus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppProject, AppRuntimeState } from "@shared/apps/appTypes";

interface AppProjectListProps {
  projects: AppProject[];
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  runtime: Record<number, AppRuntimeState>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onImport: () => void;
}

const DOT_CLASS = {
  ready: "bg-emerald-500",
  "missing-manifest": "bg-amber-500",
  "invalid-manifest": "bg-destructive",
} as const;

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
      {
}
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

      {}
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
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
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
                {
}
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
                <div className="mt-0.5 pl-3.5 text-[10.5px] font-mono text-muted-foreground truncate">
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
