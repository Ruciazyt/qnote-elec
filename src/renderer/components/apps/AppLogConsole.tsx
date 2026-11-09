import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppLogLine } from "@shared/appTypes";

/**
 * 进程日志控制台
 *
 * 输出实时追加、跟随滚动到底部。用户往上翻时**不要**把他拽回底部 ——
 * 正在看报错的人最烦这个。
 *
 * 收起时只留一条标题栏：运行输出占的是屏幕下半部分，
 * 预览才是看项目的主场景，需要的时候再展开。
 *
 * ## 收起为什么是「高度动画」而不是「直接换高度」
 *
 * 直接换高度，面板会瞬间消失一大块，上面的预览区也跟着跳一下 ——
 * 看着像界面出错。改成高度过渡后，预览区是**滑**着让出空间的，
 * 两者的关系一眼就明白。
 *
 * 内容区始终挂载、靠 overflow-hidden 裁掉：这样收起再展开时
 * 滚动位置还在，也不会看到"空壳收一下、内容突然出现"。
 */
interface AppLogConsoleProps {
  lines: AppLogLine[];
  /** 清空按钮的回调；不传就不显示按钮 */
  onClear?: () => void;
  /** 是否收起 */
  collapsed: boolean;
  /** 收起 / 展开切换 */
  onToggleCollapsed: () => void;
  className?: string;
}

/** 展开时的高度 */
const LOG_HEIGHT = 190;
/** 收起时的高度 —— 只够放标题栏 */
const LOG_COLLAPSED_HEIGHT = 32;

export function AppLogConsole({
  lines,
  onClear,
  collapsed,
  onToggleCollapsed,
  className,
}: AppLogConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  /** 判断用户是不是贴在底部 —— 是就自动跟随，不是就别动 */
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

      {/* 内容区始终挂载：收起时由外层裁掉，展开后滚动位置还在 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-hidden={collapsed}
        className="flex-1 min-h-0 overflow-y-auto bg-muted/10 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            还没有输出。启动项目后，标准输出与错误输出会出现在这里。
          </p>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.at}-${index}`}
              className={cn(
                "whitespace-pre-wrap break-all",
                line.stream === "stderr" && "text-destructive/90",
                line.stream === "system" && "text-muted-foreground/80"
              )}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
