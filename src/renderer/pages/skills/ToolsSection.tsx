import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import GitlabConfigButton from "./GitlabConfigButton";
import GitlabBotConfigButton from "./GitlabBotConfigButton";
import GithubConfigButton from "./GithubConfigButton";
import ToolGroup, { COLLAPSE_MOTION } from "./ToolGroup";
import { useToolGroupCollapse } from "./useToolGroupCollapse";
import type { BuiltinToolState } from "@shared/ai/tools";

const GROUP_ORDER = [
  "笔记",
  "待办",
  "剪贴板",
  "记忆",
  "网页",
  "浏览器",
  "应用",
  "GitLab",
  "GitHub",
  "其他",
];

function groupRank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

export default function ToolsSection() {
  const { toast } = useToast();

  const [tools, setTools] = useState<BuiltinToolState[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { isCollapsed, toggle, collapseAll, expandAll } = useToolGroupCollapse();

  const load = useCallback(async () => {
    try {
      const list = await window.electron.listBuiltinTools();
      setTools(list || []);
    } catch (err) {
      console.error("加载内置工具失败", err);
      toast({ title: "加载失败", description: "无法读取工具列表", variant: "destructive" });
      setTools([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyEnabled = async (
    names: string[],
    enabled: boolean
  ): Promise<void> => {
    setBusy(names[0] ?? "all");
    try {
      for (const name of names) {
        const result = await window.electron.setBuiltinToolEnabled(name, enabled);
        if (!result.success) {
          toast({ title: result.error || "操作失败", variant: "destructive" });
        }
      }
      await load();
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, BuiltinToolState[]>();
    for (const tool of tools ?? []) {
      if (
        q &&
        !tool.title.toLowerCase().includes(q) &&
        !tool.name.toLowerCase().includes(q) &&
        !tool.description.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(tool.group) ?? [];
      list.push(tool);
      map.set(tool.group, list);
    }
    return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]));
  }, [tools, query]);

  const allGroups = useMemo(
    () => [...new Set((tools ?? []).map((tool) => tool.group))],
    [tools]
  );
  const allCollapsed =
    allGroups.length > 0 && allGroups.every((group) => isCollapsed(group));

  if (tools === null) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const enabledCount = tools.filter((t) => t.enabled).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          内置工具是 AI 对话能直接调用的能力。关闭后该工具不会出现在助手的工具列表里。
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            已启用 {enabledCount}/{tools.length}
          </span>
          <Button
            variant="outline"
            className="h-9"
            disabled={busy !== null}
            onClick={() => void applyEnabled(tools.map((t) => t.name), true)}
          >
            全部启用
          </Button>
          <Button
            variant="outline"
            className="h-9"
            disabled={busy !== null}
            onClick={() => void applyEnabled(tools.map((t) => t.name), false)}
          >
            全部停用
          </Button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具"
            className="h-9 bg-muted/30 pl-8 focus-visible:bg-background"
          />
        </div>
        <Button
          variant="outline"
          className="h-9 shrink-0"
          onClick={() => {
            if (allCollapsed) expandAll();
            else collapseAll(allGroups);
          }}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 mr-1.5 transition-transform",
              COLLAPSE_MOTION,
              allCollapsed ? "rotate-0" : "rotate-90"
            )}
          />
          {allCollapsed ? "全部展开" : "全部收起"}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 py-16 text-center">
          <p className="text-sm text-muted-foreground/80">没有匹配的工具</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([group, items]) => (
            <ToolGroup
              key={group}
              group={group}
              tools={items}
              busy={busy}
              collapsed={isCollapsed(group)}
              action={
                group === "GitLab" ? (
                  <div className="flex items-center gap-1">
                    <GitlabConfigButton onSaved={() => void load()} />
                    <GitlabBotConfigButton />
                  </div>
                ) : group === "GitHub" ? (
                  <GithubConfigButton onSaved={() => void load()} />
                ) : undefined
              }
              onToggleCollapse={toggle}
              onToggle={(name, enabled) => void applyEnabled([name], enabled)}
              onToggleGroup={(g, enabled) =>
                void applyEnabled(
                  items.map((t) => t.name),
                  enabled
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
