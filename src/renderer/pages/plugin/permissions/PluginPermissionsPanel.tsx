import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import { describeCapabilities } from "@/pages/plugin/permissions/pluginPermissions";
import type { PluginRecord } from "@shared/plugin/manifest/pluginTypes";

interface PluginPermissionsPanelProps {
  plugin: PluginRecord;
  className?: string;
}

export function PluginPermissionsPanel({
  plugin,
  className,
}: PluginPermissionsPanelProps) {
  const { toast } = useToast();
  const entries = describeCapabilities(plugin.capabilities);
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await window.electron.pluginListGrants(plugin.id);
      const next: Record<string, boolean> = {};
      for (const row of rows ?? []) next[row.capability] = row.granted;
      setGrants(next);
    } catch (err) {
      console.error("读取插件授权失败", err);
    }
  }, [plugin.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: string, label: string, next: boolean) => {
    setBusyKey(key);
    try {
      const res = await window.electron.pluginSetGrant(plugin.id, key, next);
      if (!res?.ok) {
        toast({
          title: next ? "恢复授权失败" : "撤销授权失败",
          description: res?.error ?? "宿主没有接受这次改动",
          variant: "destructive",
        });
        return;
      }
      setGrants((prev) => ({ ...prev, [key]: next }));
      toast({
        title: next ? "已恢复授权" : "已撤销授权",
        description: next
          ? `插件可以再使用「${label}」`
          : `插件再调用「${label}」相关接口会立刻失败`,
      });
    } catch (err) {
      toast({
        title: next ? "恢复授权失败" : "撤销授权失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-border bg-card px-3 py-2.5 space-y-1",
          className
        )}>
        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          这个插件没有声明任何权限
        </p>
        <p className="text-label text-muted-foreground">
          没声明 capabilities 就是最小权限 —— 只能加载预览页面，不能起子进程，也不能读笔记待办。
        </p>
      </div>
    );
  }

  const areas = [...new Set(entries.map((entry) => entry.area))];

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card px-3 py-2.5 space-y-2",
        className
      )}>
      {areas.map((area) => (
        <div key={area} className="space-y-1">
          <p className="text-label font-medium text-muted-foreground">{area}</p>
          <ul className="space-y-1">
            {entries
              .filter((entry) => entry.area === area)
              .map((entry) => {
                const granted = grants[entry.key] !== false;
                return (
                  <li
                    key={entry.key}
                    className="text-sm text-foreground flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">·</span>
                    <span className="flex-1 min-w-0 break-words">
                      {entry.detail}
                    </span>
                    <span
                      className={cn(
                        "text-label shrink-0",
                        granted ? "text-muted-foreground" : "text-destructive"
                      )}>
                      {granted ? "已授权" : "已撤销"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs btn-hover shrink-0"
                      disabled={busyKey === entry.key}
                      onClick={() => void toggle(entry.key, entry.detail, !granted)}
                      aria-label={`${granted ? "撤销" : "恢复"}权限：${entry.detail}`}>
                      {granted ? "撤销" : "恢复"}
                    </Button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      <p className="text-label text-muted-foreground">
        撤销不用重启插件 —— 插件再调用对应接口会立刻被拒绝，并在它自己的运行日志里记一笔。
      </p>
    </div>
  );
}
