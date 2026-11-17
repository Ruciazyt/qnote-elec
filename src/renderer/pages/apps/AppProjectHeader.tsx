import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Copy,
  FolderOpen,
  Link2,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppProject, AppRuntimeState } from "@shared/apps/appTypes";

interface AppProjectHeaderProps {
  project: AppProject;
  runtime?: AppRuntimeState;
  previewUrl?: string;
  onStart: () => void;
  onStop: () => void;
  onEditManifest: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
  onCopyAddress?: (address: string) => void;
}

const RUNTIME_LABEL = {
  stopped: "未运行",
  starting: "启动中",
  running: "运行中",
  exited: "已退出",
  failed: "启动失败",
} as const;

const LINE = "inline-flex items-center h-5 leading-none min-w-0";

const COMPACT_AT = 620;
const PATH_AT = 760;

function compactAddress(url: string): string {
  const m = /^https?:\/\/(?:[^/:]+)(?::(\d+))?/i.exec(url);
  if (m) return m[1] ? `端口 ${m[1]}` : "默认端口";
  const parts = url.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? url;
}

export function AppProjectHeader({
  project,
  runtime,
  previewUrl,
  onStart,
  onStop,
  onEditManifest,
  onOpenFolder,
  onRemove,
  onCopyAddress,
}: AppProjectHeaderProps) {
  const running = runtime?.status === "running" || runtime?.status === "starting";
  const hasCommand = Boolean(project.command);

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

  const addressText = compact ? compactAddress(previewUrl ?? "") : previewUrl;

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
      {
}
      <span
        style={{ minWidth: 64 }}
        className={cn(
          LINE,
          "flex-shrink",
          compact ? "max-w-[120px]" : "max-w-[240px]"
        )}>
        <span className="truncate text-[15px] font-medium" title={project.name}>
          {project.name}
        </span>
      </span>

      {
}
      {!compact && (
        <span
          className={cn(
            LINE,
            "text-[11px] px-1.5 rounded border border-border/60 text-muted-foreground/80 flex-shrink-0",
            running && "text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
          )}>
          {runtime ? RUNTIME_LABEL[runtime.status] : project.status === "ready" ? "可用" : "未配置"}
        </span>
      )}

      {
}
      {project.origin === "market" && (
        <span
          className={cn(
            LINE,
            "text-[11px] px-1.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-400 flex-shrink-0"
          )}
          title="来自应用市场 —— 清单是发布者写的，第一次运行前会让你确认它要执行的命令"
        >
          来自市场
        </span>
      )}

      {
}
      {previewUrl && addressText && (
        <span
          style={{ minWidth: compact ? 100 : 80 }}
          className={cn(
            LINE,
            "group text-[12px] font-mono text-muted-foreground/85 max-w-[340px] flex-shrink gap-1.5"
          )}
          title={previewUrl}>
          <Link2 className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
          <span className="truncate">{addressText}</span>
          {onCopyAddress && (
            <button
              type="button"
              aria-label="复制地址"
              title="复制地址"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity text-muted-foreground/70 hover:text-foreground"
              onClick={() => onCopyAddress(previewUrl)}>
              <Copy className="h-3 w-3" />
            </button>
          )}
        </span>
      )}

      {}
      {showPath && (
        <span className={cn(LINE, "hidden lg:inline-flex max-w-[30%]")}>
          <span
            className="truncate text-[11px] font-mono text-muted-foreground/55"
            title={project.path}>
            {project.path}
          </span>
        </span>
      )}

      <div className="flex-1" />

      {}
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
            onClick={onStart}>
            <Play className="h-3.5 w-3.5 mr-1" />
            启动
          </Button>
        ))}

      {secondaryAction(
        project.status === "ready" ? "编辑清单" : "配置清单",
        <Pencil className="h-3.5 w-3.5" />,
        onEditManifest
      )}
      {secondaryAction("打开目录", <FolderOpen className="h-3.5 w-3.5" />, onOpenFolder)}
      {secondaryAction(
        "移除",
        <Trash2 className="h-3.5 w-3.5" />,
        onRemove,
        true
      )}
    </div>
  );
}
