import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PluginLogLine } from "@shared/plugin/manifest/pluginTypes";

interface PluginLogConsoleProps {
  lines: PluginLogLine[];
  onClear?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
}

const LOG_HEIGHT = 190;
const LOG_COLLAPSED_HEIGHT = 32;

export function PluginLogConsole({
  lines,
  onClear,
  collapsed,
  onToggleCollapsed,
  className,
}: PluginLogConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 24;
  };

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 overflow-hidden border-t border-border/60 flex-shrink-0",
        "transition-[height] duration-200 ease-out motion-reduce:transition-none",
        className
      )}
      style={{ height: collapsed ? LOG_COLLAPSED_HEIGHT : LOG_HEIGHT }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/20 flex-shrink-0">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "展开运行输出" : "收起运行输出"}>
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <ScrollText className="h-3.5 w-3.5" />
          <span>运行输出</span>
        </button>
        {lines.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{lines.length} 行</span>
        )}
        <div className="flex-1" />
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="清空输出"
            aria-label="清空输出"
            onClick={onClear}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-hidden={collapsed}
        className="flex-1 min-h-0 overflow-y-auto bg-muted/10 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            还没有输出。启动插件后，标准输出与错误输出会出现在这里。
          </p>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.at}-${index}`}
              className={cn(
                "whitespace-pre-wrap break-all",
                line.stream === "stderr" && "text-destructive",
                line.stream === "system" && "text-muted-foreground"
              )}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
