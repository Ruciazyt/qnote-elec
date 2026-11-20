import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeCapabilities } from "@/pages/plugin/pluginPermissions";
import type { PluginRecord } from "@shared/plugin/pluginTypes";

interface PluginPermissionsPanelProps {
  plugin: PluginRecord;
  className?: string;
}

export function PluginPermissionsPanel({
  plugin,
  className,
}: PluginPermissionsPanelProps) {
  const entries = describeCapabilities(plugin.capabilities);

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1",
          className
        )}>
        <p className="text-[12px] font-medium text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          这个插件没有声明任何权限
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          没声明 capabilities 就是最小权限 —— 只能加载预览页面，不能起子进程，也不能读笔记待办。
        </p>
      </div>
    );
  }

  const areas = [...new Set(entries.map((entry) => entry.area))];

  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2",
        className
      )}>
      {areas.map((area) => (
        <div key={area} className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">{area}</p>
          <ul className="space-y-1">
            {entries
              .filter((entry) => entry.area === area)
              .map((entry) => (
                <li
                  key={entry.detail}
                  className="text-[12px] text-foreground leading-relaxed flex gap-1.5">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{entry.detail}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        宿主按这份声明逐项校验：插件调用超出范围的接口会被拒绝并记进它的运行日志。
      </p>
    </div>
  );
}
