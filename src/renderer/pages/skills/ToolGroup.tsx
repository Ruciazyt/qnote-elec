import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { BuiltinToolState } from "@shared/ai/tools";

export const COLLAPSE_MOTION =
  "duration-200 ease-qnote motion-reduce:transition-none";

export interface ToolGroupProps {
  group: string;
  tools: BuiltinToolState[];
  busy: string | null;
  collapsed: boolean;
  action?: ReactNode;
  onToggleCollapse: (group: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onToggleGroup: (group: string, enabled: boolean) => void;
}

export default function ToolGroup({
  group,
  tools,
  busy,
  collapsed,
  action,
  onToggleCollapse,
  onToggle,
  onToggleGroup,
}: ToolGroupProps) {
  const allEnabled = tools.every((t) => t.enabled);
  return (
    <div className="rounded-lg border border-border/70 bg-card">
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors",
          COLLAPSE_MOTION,
          collapsed ? "border-transparent" : "border-border/60"
        )}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(group)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `展开${group}` : `收起${group}`}
          className="flex items-center gap-1.5 text-[13px] font-medium text-foreground hover:text-primary transition-colors"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              COLLAPSE_MOTION,
              collapsed ? "rotate-0" : "rotate-90"
            )}
          />
          {group}
          <span className="text-[11px] font-normal text-muted-foreground">
            {tools.filter((t) => t.enabled).length}/{tools.length}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          <Switch
            checked={allEnabled}
            disabled={busy !== null}
            onCheckedChange={(checked) => onToggleGroup(group, checked)}
            aria-label={allEnabled ? `停用${group}全部工具` : `启用${group}全部工具`}
          />
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows]",
          COLLAPSE_MOTION,
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        )}
      >
        <div
          className={cn(
            "min-h-0 overflow-hidden transition-opacity",
            COLLAPSE_MOTION,
            collapsed ? "opacity-0" : "opacity-100"
          )}
          aria-hidden={collapsed ? true : undefined}
          {...(collapsed ? ({ inert: "" } as Record<string, string>) : {})}
        >
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-start gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-foreground">
                    {tool.title}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {tool.name}
                  </span>
                  <span
                    className={
                      tool.kind === "write"
                        ? "inline-flex items-center rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground"
                        : "inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    }
                  >
                    {tool.kind === "write" ? "可写" : "只读"}
                  </span>
                  {tool.note && (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tool.note}
                    </span>
                  )}
                </div>
                {tool.description && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {tool.description}
                  </p>
                )}
              </div>
              <Switch
                checked={tool.enabled}
                disabled={busy !== null}
                onCheckedChange={(checked) => onToggle(tool.name, checked)}
                aria-label={tool.enabled ? `停用${tool.title}` : `启用${tool.title}`}
                className="mt-0.5"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
