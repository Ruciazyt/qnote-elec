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
import { cn } from "@/lib/utils";
import type {
  PluginRecord,
  PluginRuntimeState,
  PluginStatus,
} from "@shared/plugin/pluginTypes";

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
  stopped: "未运行",
  starting: "启动中",
  running: "运行中",
  exited: "已退出",
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

const COMPACT_AT = 620;
const PATH_AT = 760;

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
  const running = runtime?.status === "running" || runtime?.status === "starting";
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

  const secondaryAction = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    destructive = false
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 px-2 text-xs btn-hover",
        compact && "w-7 px-0",
        destructive && "hover:text-destructive"
      )}
      onClick={onClick}
      title={label}
      aria-label={label}>
      {icon}
      {!compact && <span className="ml-1.5">{label}</span>}
    </Button>
  );

  return (
    <div
      ref={headerRef}
      className="flex items-center gap-2.5 px-3 h-11 border-b border-border/60 flex-shrink-0">
      <span
        style={{ minWidth: compact ? 0 : 64 }}
        className={cn(
          LINE,
          "flex-shrink",
          compact ? "max-w-[120px]" : "max-w-[240px]"
        )}>
        <span className="truncate text-[15px] font-medium" title={plugin.name}>
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
            <button
              type="button"
              aria-label="复制地址"
              title="复制地址"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={() => onCopyAddress(previewAddress)}>
              <Copy className="h-3 w-3" />
            </button>
          )}
        </span>
      )}

      {onRefreshPreview && plugin.preview && (
        <button
          type="button"
          aria-label="刷新预览"
          title="刷新预览"
          className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
          onClick={onRefreshPreview}>
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
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

      <div className="flex-1" />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs btn-hover flex-shrink-0"
        onClick={onPublish}
        title="发布到插件市场"
        aria-label="发布到插件市场">
        <Upload className="h-3.5 w-3.5 mr-1" />
        发布
      </Button>

      {hasCommand &&
        (running ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs btn-hover flex-shrink-0"
            onClick={onStop}>
            <Square className="h-3.5 w-3.5 mr-1" />
            停止
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs btn-hover flex-shrink-0"
            onClick={onStart}
            disabled={!canStart}
            title={
              plugin.enabled
                ? undefined
                : "插件已禁用，先启用再启动"
            }>
            <Play className="h-3.5 w-3.5 mr-1" />
            启动
          </Button>
        ))}

      {secondaryAction(
        plugin.status === "ready" ? "编辑清单" : "配置清单",
        <Pencil className="h-3.5 w-3.5" />,
        onEditManifest
      )}
      {secondaryAction("打开目录", <FolderOpen className="h-3.5 w-3.5" />, onOpenFolder)}
      {onShowPermissions &&
        secondaryAction(
          "权限",
          <ShieldCheck className="h-3.5 w-3.5" />,
          onShowPermissions
        )}
      {onShowSettings &&
        secondaryAction(
          "设置",
          <SlidersHorizontal className="h-3.5 w-3.5" />,
          onShowSettings
        )}
      {onRestart &&
        secondaryAction(
          "重启",
          <RotateCcw className="h-3.5 w-3.5" />,
          onRestart
        )}
      {secondaryAction(
        plugin.enabled ? "禁用" : "启用",
        <Power className="h-3.5 w-3.5" />,
        () => onToggleEnabled(!plugin.enabled)
      )}
      {secondaryAction(
        "移除",
        <Trash2 className="h-3.5 w-3.5" />,
        onRemove,
        true
      )}
    </div>
  );
}
