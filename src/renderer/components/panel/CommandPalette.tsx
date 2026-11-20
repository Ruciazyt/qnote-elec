import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PluginCommandEntry } from "@shared/plugin/pluginTypes";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PluginCommandEntry[];
  pluginNames?: Record<string, string>;
  onRun: (command: string) => void;
}

interface ScoredCommand {
  entry: PluginCommandEntry;
  score: number;
}

function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;

  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, cursor);
    if (found < 0) return null;
    streak = found === cursor ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - cursor, 10);
    cursor = found + 1;
  }
  return score;
}

function scoreCommand(entry: PluginCommandEntry, query: string): number | null {
  if (!query.trim()) return 0;
  const title = fuzzyScore(query, entry.title);
  const category = entry.category ? fuzzyScore(query, entry.category) : null;
  const command = fuzzyScore(query, entry.command);
  const best = [title, category, command]
    .filter((value): value is number => value !== null)
    .reduce((max, value) => Math.max(max, value), -Infinity);
  return best === -Infinity ? null : best;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  pluginNames,
  onRun,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const scored = useMemo<ScoredCommand[]>(() => {
    const items: ScoredCommand[] = [];
    for (const entry of commands) {
      const score = scoreCommand(entry, query);
      if (score === null) continue;
      items.push({ entry, score });
    }
    return items.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.title.localeCompare(b.entry.title);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [active, scored.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((prev) => (scored.length === 0 ? 0 : (prev + 1) % scored.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((prev) =>
        scored.length === 0 ? 0 : (prev - 1 + scored.length) % scored.length
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = scored[active];
      if (!target) return;
      onRun(target.entry.command);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] top-[12%] translate-y-0 p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          搜索并执行插件注册的命令
        </DialogDescription>

        <div className="flex items-center gap-2 px-3 border-b border-border/60">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令名，回车执行"
            aria-label="搜索命令"
            className="h-11 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {scored.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {commands.length === 0
                ? "还没有插件命令"
                : "没有匹配的命令"}
            </p>
          ) : (
            scored.map((item, index) => (
              <button
                key={`${item.entry.pluginId}:${item.entry.command}`}
                type="button"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onRun(item.entry.command);
                  onOpenChange(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                  index === active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                )}>
                <Terminal className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">
                  {item.entry.category
                    ? `${item.entry.category}: ${item.entry.title}`
                    : item.entry.title}
                </span>
                <span className="text-[11px] text-muted-foreground flex-shrink-0">
                  {pluginNames?.[item.entry.pluginId] ?? item.entry.pluginId}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
