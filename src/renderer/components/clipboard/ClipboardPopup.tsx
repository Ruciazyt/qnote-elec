import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  ClipboardList,
  AppWindow,
  Image as ImageIcon,
  Type,
  Check,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useStickyHold } from "@/hooks/useStickyHold";
import { detectUrl } from "@/utils/urlDetect";
import {
  CLIPBOARD_PANEL_ITEM_COUNT,
  CLIPBOARD_PANEL_BORDER,
  CLIPBOARD_PANEL_PADDING,
  CLIPBOARD_PANEL_HEADER_HEIGHT,
  CLIPBOARD_PANEL_CARD_GAP,
  CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH,
  CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT,
  CLIPBOARD_PANEL_SIDE_CARD_HEIGHT,
  CLIPBOARD_PANEL_SHADOW_PADDING,
  formatAccelerator,
  type ClipboardPanelPosition,
} from "@shared/clipboardPanel";

interface ClipboardItem {
  id: number;
  content: string;
  type: "text" | "image";
  /** ISO 时间串 */
  time: string;
}

// window.electron 由 preload.ts 注入（通过 contextBridge）
// 类型定义见 src/renderer/electron.d.ts

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "";
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
  } catch {
    return "";
  }
}

/**
 * 剪贴板面板
 *
 * 由全局快捷键唤出（组合在设置页可配，默认 Ctrl+Shift+C），展示最近 5 条剪贴板记录。
 * 布局两档（设置页可切）：
 *   - 底部：卡片横排一条，贴在屏幕下沿，和系统 Win+V 的观感一致
 *   - 侧边：卡片竖排一列，贴在屏幕右沿
 *
 * 面板是「随手看一眼」的浮层：点一条即复制，面板**留在原地**，
 * 标题栏里弹一个「已复制」小徽标、卡片右上角打个对勾；
 * 按 Esc、点右上角关闭按钮，或点到面板外面才收起。
 */
export function ClipboardPopup() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<ClipboardPanelPosition>("bottom");
  /** 标题栏展示的唤出快捷键；读的是用户实际配置的那个组合 */
  const [hotkey, setHotkey] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  /**
   * 复制结果徽标
   *
   * 复制完不关面板 —— 原来点一下就收起，用户想连着复制两条就得唤出两次，
   * 手感太急。现在面板留着，标题栏里冒一个小徽标告诉用户复制成了哪一条。
   */
  const [copyToast, setCopyToast] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  /** 刚刚复制成功的那一条；用于在卡片上打对勾角标 */
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyToastTimer = useRef<number | null>(null);

  /**
   * 「按住 1.2 秒 → 变成屏幕便签」
   *
   * 这个面板本来就是常驻在光标旁边的快捷面板，按住一条记录 1.2 秒，
   * 就在光标处生成一张便签 —— 不用把它拖到别处。
   * 长按过程中面板不会因为失焦而消失（主进程那边有兜底）。
   */
  const { getHoldProps, holding, holdNode } = useStickyHold();

  const isBottom = position === "bottom";

  /**
   * 面板的几何数字全部来自共享层
   *
   * 之前渲染层写的是 Tailwind 硬编码类（h-[180px] / p-3 / gap-2.5），
   * 主进程写的是另一套 px 常量 —— 两边各算各的，面板边框那 2px 就漏了，
   * 卡片区比内容矮 2px，再叠上「overflow-x-auto 会把 overflow-y 算成 auto」
   * 这条 CSS 规则，面板里就多出一条竖向滚动条。
   *
   * 现在统一走共享层：数字只改一处，主进程窗口与渲染层排版永远对得上。
   * CSS 变量只给 Tailwind 任意值类用（h-[var(--card-h)] 之类），
   * 其余直接引共享常量。
   */
  const panelVars = {
    "--card-w": `${CLIPBOARD_PANEL_BOTTOM_CARD_WIDTH}px`,
    "--card-h": `${CLIPBOARD_PANEL_BOTTOM_CARD_HEIGHT}px`,
    "--side-card-h": `${CLIPBOARD_PANEL_SIDE_CARD_HEIGHT}px`,
  } as React.CSSProperties;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [history, pos, key] = await Promise.all([
        window.electron.popupGetClipboardHistory(CLIPBOARD_PANEL_ITEM_COUNT),
        window.electron.getClipboardPanelPosition(),
        window.electron.getClipboardPanelHotkey(),
      ]);
      // 再截一刀：主进程那边也限了条数，但两边都守一道更保险
      setItems((history ?? []).slice(0, CLIPBOARD_PANEL_ITEM_COUNT));
      setPosition(pos.ok && pos.position ? pos.position : "bottom");
      // 快捷键会变（用户可以在设置页改），所以每次刷新都重新读，
      // 不能把写死的那串留在标题栏上
      setHotkey(key.ok && key.accelerator ? key.accelerator : "");
      setSelectedIndex(0);
    } catch (err) {
      console.error("加载剪贴板历史失败:", err);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 主进程复用同一个窗口：第二次唤出时推一条刷新指令，把旧数据换掉
  useEffect(
    () =>
      window.electron.onPopupRefresh(() => {
        void load();
      }),
    [load]
  );

  /**
   * 弹一条复制结果提示，1.6 秒后自动消失
   *
   * 连续复制多条时只保留最后一条提示 —— 旧的不清掉的话，
   * 提示会一条叠一条堆在面板底部。
   */
  const showCopyToast = useCallback(
    (tone: "success" | "error", message: string, itemId: number | null) => {
      setCopyToast({ tone, message });
      setCopiedId(itemId);
      if (copyToastTimer.current !== null) {
        window.clearTimeout(copyToastTimer.current);
      }
      copyToastTimer.current = window.setTimeout(() => {
        setCopyToast(null);
        setCopiedId(null);
        copyToastTimer.current = null;
      }, 1600);
    },
    []
  );

  // 面板被销毁时把定时器收掉，别让它在窗口没了之后还挂着
  useEffect(
    () => () => {
      if (copyToastTimer.current !== null) {
        window.clearTimeout(copyToastTimer.current);
        copyToastTimer.current = null;
      }
    },
    []
  );

  const handleCopy = useCallback(
    async (item: ClipboardItem) => {
      const result = await window.electron.popupCopyClipboardItem(item.id);
      if (result.success) {
        // 复制成功：留在原地，弹提示告诉用户复制成了哪一条
        showCopyToast("success", "已复制", item.id);
      } else {
        showCopyToast("error", result.error || "复制失败", null);
      }
    },
    [showCopyToast]
  );

  const handleClose = useCallback(() => {
    window.electron.closePopup();
  }, []);

  const handleOpenApp = useCallback(() => {
    window.electron.showMainWindow();
  }, []);

  // 键盘导航挂在 window 上：面板整体没有可聚焦的输入框，
  // 但它是当前前台窗口，键盘事件直接落到这里
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      // 上下左右都映射到「上一条/下一条」：两种布局下手感一致，
      // 用户不用先想自己看到的是横排还是竖排
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) void handleCopy(item);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, handleCopy, handleClose]);

  const renderCard = (item: ClipboardItem, index: number) => {
    const isSelected = index === selectedIndex;
    // 整条内容就是一个网址时，正文换成链接色 —— 与主列表同一口径
    const isLink = item.type === "text" && detectUrl(item.content) !== null;
    return (
      <div
        key={item.id}
        role="button"
        tabIndex={0}
        aria-label={`复制第 ${index + 1} 条记录`}
        onClick={() => void handleCopy(item)}
        onKeyDown={(e) => {
          // 回车/空格在这里就地处理并阻断冒泡：
          // 冒到 window 上会被全局监听再处理一次，变成复制两遍。
          // preventDefault 顺带挡掉浏览器对 role="button" 的默认回车动作。
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            void handleCopy(item);
          }
        }}
        className={cn(
          "group relative flex flex-col rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer overflow-hidden",
          isBottom
            ? "h-[var(--card-h)] w-[var(--card-w)] shrink-0"
            : "h-[var(--side-card-h)] w-full shrink-0",
          isSelected
            ? "bg-primary/[0.08] border-primary/40 shadow-[0_4px_16px_hsl(var(--primary)/0.12)]"
            : "bg-card border-border/70 hover:border-primary/25",
          holding ? "opacity-60" : ""
        )}
        title="按住 1.2 秒即可变成屏幕便签"
        {...getHoldProps({ type: item.type, content: item.content })}
      >
        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {item.type === "image" ? (
            <img
              src={item.content}
              alt="剪贴板图片"
              className="h-full w-full object-contain bg-muted/20 rounded-md"
            />
          ) : (
            <pre
              className={cn(
                "font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all overflow-hidden",
                isBottom ? "line-clamp-5" : "line-clamp-2",
                isLink ? "text-link" : "text-foreground"
              )}>
              {item.content}
            </pre>
          )}
        </div>
        {/* 刚复制成功的那条：右上角打一个对勾角标
            —— 只标角不遮内容，用户还要读这条记录 */}
        {copiedId === item.id && (
          <div
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground shadow-md"
            title="已复制">
            <Check className="h-3 w-3" />
          </div>
        )}
        {/* 底部 meta 行：序号 / 类型 / 字符数 / 时间 */}
        <div className="mt-2 pt-1.5 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
          <span className="tabular-nums">{index + 1}</span>
          {item.type === "image" ? (
            <ImageIcon className="h-3 w-3" />
          ) : (
            <Type className="h-3 w-3" />
          )}
          {item.type === "text" && (
            <span className="tabular-nums">{item.content.length} 个字符</span>
          )}
          <span className="ml-auto truncate">{formatRelativeTime(item.time)}</span>
        </div>
      </div>
    );
  };

  return (
    // 外层透明：窗口本身是 transparent 的，这层 padding 专门给面板的投影
    // 留出绘制空间（主进程那边按同样的 16px 算窗口尺寸，两边对得上）
    <div
      className="h-screen w-screen"
      style={{ padding: CLIPBOARD_PANEL_SHADOW_PADDING }}>
      <div
        style={{ ...panelVars, borderWidth: CLIPBOARD_PANEL_BORDER }}
        className={cn(
          "h-full w-full flex flex-col overflow-hidden animate-popup-appear",
          "bg-background/95 backdrop-blur-xl border border-border shadow-2xl",
          isBottom ? "rounded-xl" : "rounded-2xl"
        )}>
        {/* 标题栏 */}
        <div
          className="px-3 flex items-center justify-between border-b border-border/60 bg-card/70 shrink-0 select-none"
          style={{ height: CLIPBOARD_PANEL_HEADER_HEIGHT }}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" />
            剪贴板
            {hotkey && (
              <kbd className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
                {formatAccelerator(hotkey)}
              </kbd>
            )}
            {/* 复制结果徽标：贴在标题栏里，不遮卡片内容
                —— 面板留在原地不关，1.6 秒后自动淡出 */}
            {copyToast && (
              <span
                className={cn(
                  "animate-copy-badge inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                  "text-[10px] font-medium leading-none",
                  copyToast.tone === "success"
                    ? "bg-success text-success-foreground"
                    : "bg-destructive text-destructive-foreground dark:bg-destructive/15 dark:text-destructive-foreground"
                )}
                role="status"
                aria-live="polite">
                {copyToast.tone === "success" ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <AlertCircle className="h-2.5 w-2.5" />
                )}
                {copyToast.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleOpenApp}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary-strong hover:bg-primary/10 transition-colors duration-150"
              aria-label="在应用中打开"
              title="在应用中打开">
              <AppWindow className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
              aria-label="关闭"
              title="关闭">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 卡片区 */}
        <div
          className={cn(
            "flex-1 min-h-0",
            // 滚动轴必须写死：CSS 规定一个轴不是 visible 时，
            // 另一个轴的 visible 会被算成 auto —— 只写 overflow-x-auto
            // 会顺带把纵向也变成可滚，卡片区就会多出一条竖向滚动条。
            // 面板尺寸是按内容精确算出来的（共享层 clipboardPanelBodySize），
            // 本来就不该出现滚动条，这里锁死只是兜底。
            isBottom
              ? "flex flex-row overflow-x-auto overflow-y-hidden"
              : "flex flex-col overflow-y-auto overflow-x-hidden"
          )}
          style={{
            padding: CLIPBOARD_PANEL_PADDING,
            gap: CLIPBOARD_PANEL_CARD_GAP,
          }}>
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-1 text-center">
              <ClipboardList className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">还没有剪贴板记录</p>
              <p className="text-[11px] text-muted-foreground/70">
                复制点内容就会出现在这里
              </p>
            </div>
          ) : (
            items.map(renderCard)
          )}
        </div>
        {holdNode}
      </div>
    </div>
  );
}
