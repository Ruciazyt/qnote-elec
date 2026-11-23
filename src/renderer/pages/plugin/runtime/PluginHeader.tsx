import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Copy,
  FolderOpen,
  Link2,
  Pencil,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  PluginRecord,
  PluginRuntimeState,
  PluginStatus,
} from "@shared/plugin/manifest/pluginTypes";

interface PluginHeaderProps {
  plugin: PluginRecord;
  runtime?: PluginRuntimeState;
  previewAddress?: string;
  onPublish: () => void;
  onStart: () => void;
  onStop: () => void;
  onEditManifest: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onShowPermissions?: () => void;
  onShowSettings?: () => void;
  onRestart?: () => void;
  onCopyAddress?: (address: string) => void;
  onRefreshPreview?: () => void;
}

const RUNTIME_LABEL = {
  inactive: "未运行",
  activating: "启动中",
  active: "运行中",
  deactivating: "停止中",
  failed: "启动失败",
} as const;

const STATUS_BADGE: Record<PluginStatus, { label: string; className: string }> = {
  ready: {
    label: "可用",
    className: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  },
  "missing-manifest": {
    label: "缺少清单",
    className: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  },
  "invalid-manifest": {
    label: "清单无效",
    className: "border-destructive/40 text-destructive",
  },
  incompatible: {
    label: "版本不兼容",
    className: "border-violet-500/40 text-violet-700 dark:text-violet-400",
  },
};

const LINE = "inline-flex items-center h-5 leading-none min-w-0";

const COMPACT_AT = 520;
const PATH_AT = 760;

interface IconButtonOptions {
  variant?: "outline" | "ghost";
  destructive?: boolean;
  hint?: string;
}

export function PluginHeader({
  plugin,
  runtime,
  previewAddress,
  onPublish,
  onStart,
  onStop,
  onEditManifest,
  onOpenFolder,
  onRemove,
  onToggleEnabled,
  onShowPermissions,
  onShowSettings,
  onRestart,
  onCopyAddress,
  onRefreshPreview,
}: PluginHeaderProps) {
  const running = runtime?.status === "active" || runtime?.status === "activating";
  const hasCommand = Boolean(plugin.command);
  const canStart =
    hasCommand && plugin.enabled && plugin.status === "ready" && !running;
  const badge = STATUS_BADGE[plugin.status];

  const headerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const sync = () => {
      const next = el.clientWidth;
      setAvailable((prev) => (prev === next ? prev : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const compact = available > 0 && available < COMPACT_AT;
  const showPath = available === 0 || available >= PATH_AT;

  const iconButton = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    options?: IconButtonOptions
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={options?.variant ?? "ghost"}
          size="icon"
          className={cn(
            "h-7 w-7 btn-hover",
            options?.destructive && "hover:text-destructive"
          )}
          onClick={onClick}
          aria-label={label}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <p className="text-xs">{options?.hint ?? label}</p>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={headerRef}
        className="flex items-center gap-2 px-3 h-11 border-b border-border/60 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
          <span
            style={{ minWidth: compact ? 0 : 64 }}
            className={cn(
              LINE,
              "flex-shrink",
              compact ? "max-w-[120px]" : "max-w-[240px]"
            )}>
            <span
              className="truncate min-w-0 text-[15px] font-medium"
              title={plugin.name}>
              {plugin.name}
            </span>
          </span>

          {!compact && (
            <span
              className={cn(
                LINE,
                "text-[11px] px-1.5 rounded border flex-shrink-0",
                badge.className
              )}>
              {badge.label}
            </span>
          )}

          {!compact && plugin.version && (
            <span className={cn(LINE, "text-[11px] text-muted-foreground flex-shrink-0")}>
              v{plugin.version}
            </span>
          )}

          {!compact && (
            <span
              className={cn(
                LINE,
                "text-[11px] px-1.5 rounded border border-border/60 text-muted-foreground flex-shrink-0"
              )}
              title={runtime ? RUNTIME_LABEL[runtime.status] : undefined}>
              {runtime ? RUNTIME_LABEL[runtime.status] : "未运行"}
            </span>
          )}

          {plugin.origin === "market" && (
            <span
              className={cn(
                LINE,
                "text-[11px] px-1.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-400 flex-shrink-0"
              )}
              title="来自插件市场 —— 清单是发布者写的，第一次运行前会让你确认它要执行的命令"
            >
              来自市场
            </span>
          )}

          {previewAddress && !compact && (
            <span
              style={{ minWidth: 80 }}
              className={cn(
                LINE,
                "group text-[12px] font-mono text-muted-foreground max-w-[340px] flex-shrink gap-1.5"
              )}
              title={previewAddress}>
              <Link2 className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{previewAddress}</span>
              {onCopyAddress && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="复制地址"
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      onClick={() => onCopyAddress(previewAddress)}>
                      <Copy className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    <p className="text-xs">复制地址</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </span>
          )}

          {onRefreshPreview && plugin.preview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="刷新预览"
                  className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  onClick={onRefreshPreview}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                <p className="text-xs">刷新预览</p>
              </TooltipContent>
            </Tooltip>
          )}

          {showPath && (
            <span className={cn(LINE, "hidden lg:inline-flex max-w-[30%]")}>
              <span
                className="truncate text-[11px] font-mono text-muted-foreground"
                title={plugin.path}>
                {plugin.path}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {iconButton(
            "发布到插件市场",
            <Upload className="h-3.5 w-3.5" />,
            onPublish,
            { variant: "outline" }
          )}

          {hasCommand &&
            (running ? (
              iconButton("停止插件", <Square className="h-3.5 w-3.5" />, onStop, {
                variant: "outline",
              })
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 btn-hover"
                      onClick={onStart}
                      disabled={!canStart}
                      aria-label="启动插件">
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  <p className="text-xs">
                    {canStart ? "启动插件" : "插件已禁用，先启用再启动"}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}

          {iconButton(
            plugin.status === "ready" ? "编辑清单" : "配置清单",
            <Pencil className="h-3.5 w-3.5" />,
            onEditManifest
          )}
          {iconButton("打开目录", <FolderOpen className="h-3.5 w-3.5" />, onOpenFolder)}
          {onShowPermissions &&
            iconButton("权限", <ShieldCheck className="h-3.5 w-3.5" />, onShowPermissions)}
          {onShowSettings &&
            iconButton("设置", <SlidersHorizontal className="h-3.5 w-3.5" />, onShowSettings)}
          {onRestart &&
            iconButton("重启", <RotateCcw className="h-3.5 w-3.5" />, onRestart)}
          {iconButton(
            plugin.enabled ? "禁用" : "启用",
            <Power className="h-3.5 w-3.5" />,
            () => onToggleEnabled(!plugin.enabled)
          )}
          {iconButton("移除", <Trash2 className="h-3.5 w-3.5" />, onRemove, {
            destructive: true,
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
