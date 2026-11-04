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
import type { AppProject, AppRuntimeState } from "@shared/appTypes";

/**
 * 项目详情头部
 *
 * ## 垂直对齐是怎么处理的
 *
 * 标题、状态徽标、地址、路径四者的字号不同，光靠 flex 的 items-center
 * 只会让它们的**盒子**对齐，字的视觉中心仍然会错开 —— 15px 的标题
 * 字形比 11px 的徽标高，看上去就"浮"在上面一点。
 *
 * 这里的做法是：每个元素都套进一个**同样高度**的行盒（h-5），
 * 盒子内部 leading-none，行盒之间再 items-center ——
 * 两层对齐叠起来，文字的视觉中心才真正落在同一条线上。
 *
 * ## 空间不够时怎么退让
 *
 * 头部是这一行里唯一要塞下「标题 + 状态 + 地址 + 路径 + 四个操作」的地方，
 * 而宽度还取决于左侧栏拖到了多宽 —— 用户把侧栏拉宽，标题区就被压扁。
 *
 * 压扁的默认结果是所有可伸缩元素一起缩到 0：项目名只剩一个 "i..."，
 * 地址只剩一个链环图标，谁也读不出信息。所以这里改成**按优先级逐级退场**：
 *
 * 1. 先把路径整块撤掉（它信息量最低，且末尾已经能从清单里查到）
 * 2. 再把三个次要操作收成纯图标（标题保留 aria-label 与 tooltip 说明）
 * 3. 标题与地址各自保底留一段宽度，不允许缩成看不见
 *
 * 判定用的是头部自身的可用宽度，而不是窗口宽度 —— 侧栏占了多少，
 * 只有这一行知道。
 */
interface AppProjectHeaderProps {
  project: AppProject;
  runtime?: AppRuntimeState;
  /** 当前预览页面的地址（含端口）；没有预览时为空 */
  previewUrl?: string;
  onStart: () => void;
  onStop: () => void;
  onEditManifest: () => void;
  onOpenFolder: () => void;
  onRemove: () => void;
  onCopyAddress?: (address: string) => void;
}

/** 运行状态的中文描述 */
const RUNTIME_LABEL = {
  stopped: "未运行",
  starting: "启动中",
  running: "运行中",
  exited: "已退出",
  failed: "启动失败",
} as const;

/** 所有头部元素共用的行盒 —— 高度一致，文字才会真正对齐 */
const LINE = "inline-flex items-center h-5 leading-none min-w-0";

/** 宽度低于此值：次要操作收成纯图标 */
const COMPACT_AT = 620;
/** 宽度低于此值：路径整块撤掉 */
const PATH_AT = 760;

/**
 * 紧凑态下显示的地址
 *
 * http(s) 地址取端口，本地文件取文件名 —— 两种情况都只留"最可执行的那一截"。
 */
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

  /**
   * 头部自身的可用宽度
   *
   * 用 ResizeObserver 量自己，而不是看 window.innerWidth ——
   * 左侧栏能拖宽，同一个窗口宽度下标题区的可用空间完全不同。
   */
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

  /** 还没量到宽度时按宽松处理，避免首帧闪一下紧凑态 */
  const compact = available > 0 && available < COMPACT_AT;
  const showPath = available === 0 || available >= PATH_AT;

  /**
   * 头部显示的地址文本
   *
   * 紧凑模式下只留**端口**：主机多半是 127.0.0.1 或 localhost，信息量很低，
   * 而端口才是用户要的那一截（贴到浏览器、贴到别的工具里）。
   * 完整地址仍在 title 提示与复制按钮里。
   */
  const addressText = compact ? compactAddress(previewUrl ?? "") : previewUrl;

  /** 次要操作：宽的时候带文字，窄的时候只留图标 */
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
      {/* 标题 —— 保底留一段宽度，不允许缩成一个字母。
          紧凑模式把上限压到 120px：标题的名字在左侧列表里也有，
          而地址里的端口只有这一处能看到，宽度优先让给它。

          minWidth 写在行内而不是类上：LINE 里带着 min-w-0，
          两个 min-width 工具类谁赢取决于它们在样式表里的先后，不可靠。 */}
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

      {/* 状态徽标 —— 紧凑时撤掉：
          启动/停止按钮已经说明了运行与否，配置状态在左侧列表的状态点里也有，
          而这一格让给地址之后，端口才露得出来。 */}
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

      {/* 预览地址 —— 端口信息就在这里。
          紧凑态下这一格显示的是「端口 7788」，宽度绰绰有余；
          完整地址在 title 提示与复制按钮里。 */}
      {previewUrl && addressText && (
        <span
          /* 紧凑态留 100px：链环图标 12 + 间隔 6 + 复制按钮 18 + 「端口 7788」约 56 */
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
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/70 hover:text-foreground"
              onClick={() => onCopyAddress(previewUrl)}>
              <Copy className="h-3 w-3" />
            </button>
          )}
        </span>
      )}

      {/* 项目路径 —— 空间紧张时先让它退场，地址比路径重要 */}
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

      {/* 操作 */}
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
