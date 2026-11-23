import { Boxes, FolderPlus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  PluginRecord,
  PluginRuntimeState,
  PluginStatus,
} from "@shared/plugin/manifest/pluginTypes";

interface PluginListProps {
  plugins: PluginRecord[];
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  runtime: Record<string, PluginRuntimeState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
}

const DOT_CLASS: Record<PluginStatus, string> = {
  ready: "bg-emerald-500",
  "missing-manifest": "bg-amber-500",
  "invalid-manifest": "bg-destructive",
  incompatible: "bg-violet-500",
};

function tailPath(fullPath: string, segments = 2): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) return fullPath;
  return `…\\${parts.slice(-segments).join("\\")}`;
}

export function PluginList({
  plugins,
  keyword,
  onKeywordChange,
  runtime,
  selectedId,
  onSelect,
  onImport,
}: PluginListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="搜索插件"
            className="h-7 pl-7 text-xs"
            aria-label="搜索插件"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {plugins.length === 0 ? (
          <div className="py-10 px-3 text-center">
            <div className="relative w-11 h-11 mx-auto mb-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Boxes className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              {keyword.trim() ? "没有匹配的插件" : "还没有导入插件"}
            </p>
            {!keyword.trim() && (
              <>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  导入一个带 plugin.json 的文件夹
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
          plugins.map((plugin) => {
            const rt = runtime[plugin.id];
            const running = rt?.status === "active" || rt?.status === "activating";
            const isSelected = plugin.id === selectedId;

            return (
              <button
                key={plugin.id}
                type="button"
                onClick={() => onSelect(plugin.id)}
                title={plugin.path}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "relative w-full text-left rounded-md pl-2.5 pr-2 py-1.5 transition-colors",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50"
                )}>
                {isSelected && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                )}
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full flex-shrink-0",
                      DOT_CLASS[plugin.status]
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-medium truncate flex-1">{plugin.name}</span>
                  {running && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex-shrink-0 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      运行中
                    </span>
                  )}
                </div>
                <div className="mt-0.5 pl-3.5 text-[10.5px] font-mono text-muted-foreground truncate">
                  {tailPath(plugin.path)}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
