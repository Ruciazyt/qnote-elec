import React, { RefObject, useState } from "react";
import { formatDistanceToNow, format, isSameDay, isToday, isYesterday } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  Copy, Trash2, Pin, PinOff, Star, Code, Check, Image as ImageIcon, Clock, ListChecks,
  NotebookPen, Loader2, ChevronDown, ChevronLeft, MoreHorizontal, Pencil, Save,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ClipboardRecord } from "./types";
import { getSupportedLanguages, SupportedLanguage } from "@/utils/codeFormatter";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";

const languageToPrismClass: Record<SupportedLanguage, string> = {
  javascript: "language-javascript",
  typescript: "language-typescript",
  json: "language-json",
  html: "language-markup",
  css: "language-css",
};

interface ClipboardListProps {
  clipboardHistory: ClipboardRecord[];
  isLoading?: boolean;
  formattedLanguages: Record<number, SupportedLanguage>;
  formattingRecordId: number | undefined;
  onFormatCode: (record: ClipboardRecord, language: SupportedLanguage) => void;
  onCopy: (content: string, type: "text" | "image") => void;
  onDeleteRecord: (id: number) => void;
  onAddToVector: (record: ClipboardRecord) => void;
  onTogglePin?: (record: ClipboardRecord) => void;
  onToggleImportant?: (record: ClipboardRecord) => void;
  onAddToTodo?: (record: ClipboardRecord) => void;
  /** 存为笔记：文本落成 .md，图片落成 .png */
  onSaveAsNote?: (record: ClipboardRecord) => void;
  /** 正在存为笔记的记录 id，用于按钮转圈 */
  savingNoteId?: number | null;
  /**
   * 保存编辑后的正文。
   *
   * 返回 Promise：**失败时要 reject**，列表据此保留编辑态而不是把没存上的内容
   * 直接从界面上抹掉；错误提示由调用方（HomePage）负责弹。
   */
  onUpdateContent?: (record: ClipboardRecord, content: string) => Promise<void>;
  onImageClick: (img: string) => void;
  codeContainerRef: RefObject<HTMLDivElement>;
}

/**
 * Format a date as a day separator label
 * Today: "今天" · Yesterday: "昨天" · Within week: "周X" · Older: "MM-DD"
 */
function getDaySeparatorLabel(date: Date): string {
  if (isToday(date)) return "今天";
  if (isYesterday(date)) return "昨天";
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const weekdays = "周日周一周二周三周四周五周六".split("");
    return weekdays[date.getDay()];
  }
  return format(date, "MM-dd");
}

/**
 * 状态条上的简述：压平空白后取前 N 个字符。
 *
 * ## 为什么不能只靠 CSS truncate
 *
 * `truncate` 里有 `white-space: nowrap`，这会让元素的 **min-content 等于整段文字的
 * 宽度**。而祖先链上 `<main>` 和 `.content-panel` 都是 `min-width: auto` 的 flex item，
 * automatic minimum size 会把这个 min-content 一路顶上去 —— 实测一行长代码就把
 * 1070px 的窗口撑到了 5730px，简述、操作栏全被推到屏幕外。
 *
 * `min-w-0` 只在「这一行自己的宽度已被确定」时才管用，挡不住上面这条链。
 * 所以先用字符数封顶，让 min-content 有界；CSS truncate 只负责按实际宽度做最后的省略。
 */
function buildPreview(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/* ───────────────────── 更多（次要操作）菜单 ─────────────────────
 *
 * ## 为什么要收起来
 *
 * 一条记录原本挂着 8 个图标按钮，但真正每天都会点的只有「复制 / 删除 / 置顶」几个，
 * 其余（记忆索引、Todo、存为笔记、代码高亮、重要）都属于「偶尔想起来才用得上」。
 * 8 个按钮把操作栏撑满一整行，窄窗口下还会把卡片横向顶开，扫一眼过去反而
 * 找不到常用的那几个。收成「4 个常用 + 1 个更多」之后，操作栏宽度基本固定，
 * 视线也只需要在左边那一小段里扫。
 *
 * ## 为什么用 Popover 而不是自己写绝对定位的下拉
 *
 * 自己写要自己处理点外部关闭、Esc、焦点、以及被滚动容器裁切 —— 原来的
 * 语言下拉就是纯绝对定位，被 overflow 裁过一次。用 Radix Popover 这些
 * 天然就有，内容走 Portal 挂在 body 上，卡片怎么滚动都不会切掉它。
 */

interface MoreMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 普通条目：点一下执行 */
  onSelect?: () => void;
  /**
   * 二级面板：点开后整层菜单被替换成这里返回的内容。
   * 参数是关闭菜单的回调 —— 面板里的按钮要自己决定何时收菜单
   * （选语言后要关，但「返回」不能关）。
   */
  panel?: (close: () => void) => React.ReactNode;
  /** 开关态条目（记忆索引 / 重要标记）已开启时的高亮 */
  active?: boolean;
  disabled?: boolean;
}

function RecordMoreMenu({
  items,
  triggerClassName = "",
}: {
  items: MoreMenuItem[];
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const panelItem = items.find((item) => item.key === panelKey && item.panel);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 关闭时退回一级菜单，否则下次打开会直接停在上次那层
        if (!next) setPanelKey(null);
      }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label="更多操作"
          title="更多操作"
          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50 ${triggerClassName}`}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[1000] w-52 p-1 rounded-lg bg-background/95 backdrop-blur-sm border border-border/80 shadow-[0_4px_20px_hsl(var(--foreground)/0.08),0_1px_4px_hsl(var(--foreground)/0.06)] ring-1 ring-border/60">
        {panelItem ? (
          <>
            <button
              onClick={() => setPanelKey(null)}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150">
              <ChevronLeft className="h-3 w-3 flex-shrink-0" />
              返回
            </button>
            <div className="my-1 h-px bg-border/60" />
            <div className="max-h-56 overflow-auto">{panelItem.panel!(() => setOpen(false))}</div>
          </>
        ) : (
          items
            .filter((item) => !item.disabled)
            .map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  if (item.panel) {
                    setPanelKey(item.key);
                    return;
                  }
                  // 先收菜单再执行：存为笔记这类动作会触发 toast / 重新拉列表，
                  // 菜单还开着的话会被刷新后的列表一起带走，看起来像点了没反应
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={`w-full flex items-center gap-2.5 text-left text-xs px-2 py-1.5 rounded-md font-medium transition-all duration-150 active:scale-[0.98] ${
                  item.active
                    ? "text-primary bg-primary/10"
                    : "text-foreground/85 hover:bg-primary/10 hover:text-primary"
                }`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.active && (
                  <Check className="h-3 w-3 text-primary/80 flex-shrink-0" style={{ strokeWidth: 2.5 }} />
                )}
              </button>
            ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ClipboardList({
  clipboardHistory,
  isLoading = false,
  formattedLanguages,
  formattingRecordId,
  onFormatCode,
  onCopy,
  onDeleteRecord,
  onAddToVector,
  onTogglePin,
  onToggleImportant,
  onAddToTodo,
  onSaveAsNote,
  savingNoteId = null,
  onUpdateContent,
  onImageClick,
  codeContainerRef,
}: ClipboardListProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  /**
   * 置顶项默认收起
   *
   * 置顶区的作用是「钉住常用条目」，不是让人反复展开阅读长内容，
   * 所以默认只显示一条【类型 + 简述 + 操作栏】的状态条，点一下才展开成完整卡片。
   * 集合里存的是「已展开」的 id，初始为空即全部收起。
   */
  const [expandedPinned, setExpandedPinned] = useState<Set<number>>(new Set());
  const togglePinnedExpanded = (recordId: number) => {
    setExpandedPinned((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  /* ───────────────────── 编辑模式 ─────────────────────
   *
   * 剪贴板里躺着的常是「抄下来但还差一点」的东西 —— 少截一段结尾、
   * 多了个 TODO 标记、链接被换成了完整地址。直接扔掉重抄一遍太亏，
   * 所以给它一个就地编辑：点编辑 → 正文换成 textarea → 存回数据库。
   *
   * draft 与 record.content 分离是必须的：受控输入要跟着用户每一次敲键走，
   * 而 record 是数据源的快照，两者混在一起会在保存失败时把原文也弄丢。
   */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  /** 正在写库的记录 id，用于把保存按钮切成转圈并锁住重复提交 */
  const [savingId, setSavingId] = useState<number | null>(null);
  /** 编辑框随内容长高；长文本横向滚动比纵向滚动更难改 */
  const editAreaRef = useAutoGrowTextarea(editingDraft);
  /** 快捷键提示要跟平台一致，macOS 上写 Ctrl 等于教错 */
  const modifierLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘" : "Ctrl";

  const startEdit = (record: ClipboardRecord, recordId: number) => {
    // 置顶项默认收起，先展开才有地方显示编辑框
    if (record.pinned_at) {
      setExpandedPinned((prev) => new Set(prev).add(recordId));
    }
    setEditingId(recordId);
    setEditingDraft(record.content ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingDraft("");
  };

  const saveEdit = async (record: ClipboardRecord, recordId: number) => {
    // 快捷键连按会重复提交同一份内容，等上一次写完再走
    if (savingId === recordId) return;
    const next = editingDraft;
    // 空记录没有意义（列表里也只会显示成「（空内容）」），直接在按钮上拦住
    if (next.trim() === "") return;
    // 没改动就别写库，省一次 IPC + 一次 content_hash 重算
    if (next === record.content) {
      cancelEdit();
      return;
    }
    setSavingId(recordId);
    try {
      await onUpdateContent?.(record, next);
      cancelEdit();
    } catch {
      // 失败时**保留编辑态**：内容还没存上，直接退出等于让用户白改一遍。
      // 错误提示由 HomePage 弹出，这里不再重复打扰。
    } finally {
      setSavingId(null);
    }
  };

  /**
   * 复制一条记录。
   *
   * 顶部复制按钮和内容区双击共用这一条路径，保证按钮态与「已复制」徽章
   * 两处反馈完全一致，不会出现一边变了另一边没变。
   */
  const handleCopyRecord = (record: ClipboardRecord, recordId: number) => {
    onCopy(record.content, record.type);
    setCopiedId(recordId);
    setTimeout(() => setCopiedId(null), 2500);
  };

  if (isLoading) {
    return (
      <div className="clipboard-code flex-1 overflow-auto px-4 py-2 space-y-4" ref={codeContainerRef}>
        {[0, 1, 2].map((i) => (
          <Card
            key={i}
            data-skeleton-card
            className="p-4 border border-border/60"
>
            <div className="flex items-start gap-4">
              {/* Type badge skeleton */}
              <Skeleton className="h-5 w-10 rounded flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-3">
                {/* Code block skeleton — mimics real content height */}
                <Skeleton className="h-[72px] w-full rounded-md" />
                <div className="flex items-center gap-2 flex-wrap">
                  <Skeleton className="h-3 w-16 rounded" />
                  <Skeleton className="h-3 w-12 rounded" />
                </div>
              </div>
              {/* Action buttons skeleton */}
              <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  /* ── Empty state — shown when clipboardHistory is empty ── */
  if (clipboardHistory.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6 animate-fade-in" ref={codeContainerRef}>
        <div className="animate-fade-in-stagger text-center" style={{ animationDelay: "120ms" }}>
          <p className="text-sm font-semibold text-foreground/70 mb-1.5">暂无记录</p>
          <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[200px]">
            复制内容后将自动显示在这里
          </p>
        </div>
      </div>
    );
  }

  // Pre-compute separator flags: show a date separator before a card when its date differs from the previous card
  type RenderItem =
    | { kind: "card"; record: ClipboardRecord; recordId: number; index: number }
    | { kind: "separator"; label: string }
    | { kind: "pinned" };
  // 置顶记录已经在主进程排到最前，这里拆成两组：置顶组只有一个统一表头，
  // 剩下的才按日期切分 —— 否则置顶记录会带着自己的日期标签插在日期流里，看着像乱序
  const pinnedRecords = clipboardHistory.filter((r) => r.pinned_at);
  const datedRecords = clipboardHistory.filter((r) => !r.pinned_at);

  const renderItems: RenderItem[] = [];
  if (pinnedRecords.length > 0) {
    renderItems.push({ kind: "pinned" });
    pinnedRecords.forEach((record, index) => {
      renderItems.push({ kind: "card", record, recordId: record.id ?? index, index });
    });
  }
  datedRecords.forEach((record, index) => {
    const prevRecord = datedRecords[index - 1];
    if (index === 0 || !prevRecord || !isSameDay(new Date(record.time), new Date(prevRecord.time))) {
      renderItems.push({ kind: "separator", label: getDaySeparatorLabel(new Date(record.time)) });
    }
    renderItems.push({ kind: "card", record, recordId: record.id ?? index, index });
  });

  return (
    <TooltipProvider>
    {/*
      Fix: Wrapped scroll area in relative+absolute container to support
      top/bottom fade gradients. The fade divs are absolute-positioned inside the relative
      wrapper, which sits behind the scrollable content layer (z-index: auto). This gives
      a premium "content scrolls beneath frosted edges" feel consistent with AiChatPanel,
      and provides clear scroll affordance when the list overflows the viewport.
    */}
    <div className="relative flex flex-1 flex-col min-h-0 clipboard-scroll-container">
      {/* Top fade — subtle, signals content above when scrolled down */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 h-6 pointer-events-none z-[1] clipboard-scroll-fade-top"
      />
      {/* Bottom fade — indicates more content below when list overflows */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none z-[1] clipboard-scroll-fade-bottom"
      />
      <div
        className="clipboard-code flex-1 overflow-auto px-4 py-2 space-y-1"
        ref={codeContainerRef}
      >
      {renderItems.map((item, renderIndex) => {
        if (item.kind === "pinned") {
          return (
            <div key="pinned-header" className="flex items-center justify-center my-4 py-1">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary/70 uppercase tracking-widest">
                <Pin className="h-2.5 w-2.5" />
                置顶
              </span>
            </div>
          );
        }

        if (item.kind === "separator") {
          // 原本两侧各有一条 day-sep-line 渐变线；卡片已经用拟态阴影表达区域，
          // 这里的横线就成了多余的第二层分隔，去掉只保留日期标签
          return (
            <div key={`sep-${item.label}-${renderIndex}`} className="flex items-center justify-center my-4 py-1">
              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                {item.label}
              </span>
            </div>
          );
        }

        const { record, recordId, index } = item;
        const highlightLanguage =
          typeof record.id === "number" ? formattedLanguages[record.id] : undefined;
        const codeClassName = highlightLanguage
          ? languageToPrismClass[highlightLanguage] || "language-none"
          : "language-none";
        const isPlainCode = !highlightLanguage;
        // Language label lookup for the active badge
        const activeLanguageLabel = highlightLanguage
          ? getSupportedLanguages().find((l) => l.value === highlightLanguage)?.label
          : undefined;
        // 跟列表里其它地方一样用 recordId（record.id ?? index），别拿 record.id 直接比：
        // record.id 可能是 undefined，跟"正在格式化"的 id 比永远对不上
        const isFormatLoading = formattingRecordId === recordId;
        const isPinned = Boolean(record.pinned_at);
        const isImportant = Boolean(record.is_important);
        const isEditing = editingId === recordId;

        /**
         * 次要操作统一进「更多」菜单。
         *
         * 图标和文案沿用原来操作栏里的那一批，只是换了位置 —— 用户不用重新认一遍。
         * 记忆索引 / 重要标记是开关态，用高亮 + 勾表示当前状态，省掉一个来回确认。
         */
        const moreMenuItems: MoreMenuItem[] = [
          {
            key: "vector",
            label: record.vector_indexed ? "移出记忆索引" : "添加到记忆索引",
            icon: record.vector_indexed ? (
              <Pin className="h-3.5 w-3.5" />
            ) : (
              <PinOff className="h-3.5 w-3.5" />
            ),
            active: Boolean(record.vector_indexed),
            // 原来这里是给按钮加 spring-pulse 动画，现在条目点完菜单就收了，
            // 脉冲打在被关掉的菜单上没人看得见；反馈交给 toast 和菜单里的勾选态
            onSelect: () => onAddToVector(record),
          },
        ];

        if (onAddToTodo) {
          moreMenuItems.push({
            key: "todo",
            label: record.type === "image" ? "添加为 Todo 附件" : "添加到 Todo",
            icon: <ListChecks className="h-3.5 w-3.5" />,
            onSelect: () => onAddToTodo(record),
          });
        }

        if (onSaveAsNote) {
          moreMenuItems.push({
            key: "note",
            label: savingNoteId === recordId
              ? "正在保存…"
              : record.type === "image"
                ? "存为图片笔记"
                : "存为文本笔记",
            icon:
              savingNoteId === recordId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <NotebookPen className="h-3.5 w-3.5" />
              ),
            disabled: savingNoteId === recordId,
            onSelect: () => onSaveAsNote(record),
          });
        }

        // 代码高亮是二级面板：语言有 5 种，和其它单次点击的动作挤在一层会让菜单变很长
        if (record.type === "text") {
          moreMenuItems.push({
            key: "highlight",
            label: activeLanguageLabel ? `代码高亮（${activeLanguageLabel}）` : "代码高亮",
            icon: isFormatLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Code className="h-3.5 w-3.5" />
            ),
            active: Boolean(highlightLanguage),
            panel: (close) => (
              <div className="flex flex-col gap-0.5">
                {getSupportedLanguages().map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => {
                      close();
                      onFormatCode(record, lang.value as SupportedLanguage);
                    }}
                    className="flex items-center justify-between text-left text-xs px-2 py-1.5 rounded-md font-medium text-foreground/85 hover:bg-primary/10 hover:text-primary active:scale-[0.98] transition-all duration-150">
                    <span className="truncate">{lang.label}</span>
                    {highlightLanguage === lang.value && (
                      <Check className="h-3 w-3 text-primary/80 flex-shrink-0" style={{ strokeWidth: 2.5 }} />
                    )}
                  </button>
                ))}
              </div>
            ),
          });
        }

        if (onToggleImportant) {
          moreMenuItems.push({
            key: "important",
            label: isImportant ? "取消重要标记" : "标记为重要",
            icon: <Star className={`h-3.5 w-3.5 ${isImportant ? "fill-current" : ""}`} />,
            active: isImportant,
            onSelect: () => onToggleImportant(record),
          });
        }

        // 置顶项默认收起：只显示【类型 + 简述 + 操作栏】状态条，点整行展开
        if (isPinned && !expandedPinned.has(recordId)) {
          const previewText = record.type === "text" ? buildPreview(record.content) : "";
          return (
            <Card
              key={recordId}
              className="relative p-0 border-0 animate-fade-in group card-accent-border neu-raised neu-raised-hover hover:-translate-y-1 hover:scale-[1.004]"
              style={{
                animationDelay: `${Math.min(index, 40) * 50}ms`,
                animationFillMode: "both",
              }}>
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                onClick={() => togglePinnedExpanded(recordId)}
                aria-expanded={false}
                title={previewText ? previewText.slice(0, 200) : "图片记录"}>
                {/* 类型 */}
                <span
                  className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors badge-hover ${
                    record.type === "text"
                      ? "bg-secondary/50 text-secondary-foreground border border-secondary/40 dark:bg-secondary/50 dark:text-secondary-foreground dark:border-secondary/30"
                      : "clipboard-image-badge badge-hover"
                  }`}>
                  {record.type === "text" ? (
                    "文本"
                  ) : (
                    <>
                      <ImageIcon className="h-3 w-3" />
                      图片
                    </>
                  )}
                </span>

                {/* 简述：宽度由 truncate 自适应，长内容不会被撑开 */}
                {record.type === "text" ? (
                  <span className="flex-1 min-w-0 truncate text-xs font-mono text-foreground/80">
                    {previewText || "（空内容）"}
                  </span>
                ) : (
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    <img
                      src={record.content}
                      alt=""
                      className="h-5 w-5 rounded object-cover flex-shrink-0 border border-border/40"
                    />
                    <span className="truncate text-xs text-muted-foreground/80">图片记录</span>
                  </span>
                )}

                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors" />

                {/*
                  操作栏：点按钮不触发展开。

                  按钮尺寸和间距**完全照搬展开态**（h-8 w-8 + gap-0.5），不另立一套。
                  同一条记录在收起/展开之间来回切换时，按钮不该跟着变形、位置也不该
                  跟着跳 —— 收起条本来就是同一条记录的另一种读法，不是另一种控件。
                */}
                <div
                  className="flex items-center gap-0.5 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => handleCopyRecord(record, recordId)}
                        variant={copiedId === recordId ? "secondary" : "ghost"}
                        aria-label="复制内容"
                        className={`h-8 w-8 p-0 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/50 ${
                          copiedId === recordId
                            ? "copy-success-btn"
                            : "hover:bg-muted hover:text-foreground active:scale-95"
                        }`}>
                        {copiedId === recordId ? (
                          <Check className="h-3.5 w-3.5 copy-success-check" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      <p className="text-xs">{copiedId === recordId ? "已复制" : "复制内容"}</p>
                    </TooltipContent>
                  </Tooltip>

                  {onTogglePin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onTogglePin(record)}
                          variant="ghost"
                          aria-label="取消置顶"
                          className="h-8 w-8 p-0 transition-all duration-150 text-primary bg-primary/15 hover:bg-primary/20 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50">
                          <Pin className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">取消置顶</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {/* 编辑只在收起条上留一个入口：置顶项恰恰是最常被反复修改的那批 */}
                  {record.type === "text" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => startEdit(record, recordId)}
                          variant="ghost"
                          aria-label="编辑内容"
                          className="h-8 w-8 p-0 transition-all duration-150 hover:bg-primary/10 hover:text-primary active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">编辑内容</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  <RecordMoreMenu
                    items={moreMenuItems}
                    triggerClassName="hover:bg-muted hover:text-foreground"
                  />

                  {/* 同展开态：删除压在最后 */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => record.id !== undefined ? onDeleteRecord(record.id) : null}
                        variant="ghost"
                        aria-label="删除记录"
                        className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-destructive/50 btn-delete-hover hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      <p className="text-xs">删除记录</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </Card>
          );
        }

        return (
          <Card
            key={recordId}
            className={`relative p-4 border-0 transition-all duration-200 animate-fade-in group card-accent-border ${
              isEditing
                ? "z-50 neu-raised neu-raised-open"
                : "neu-raised neu-raised-hover hover:-translate-y-1 hover:scale-[1.004]"
            }`}
            style={{
              animationDelay: `${Math.min(index, 40) * 50}ms`,
              animationFillMode: "both",
            }}>
            <div className="space-y-2">
              {/* 顶部行：类型徽章 + 操作按钮 */}
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors badge-hover ${
                    record.type === "text"
                      ? "bg-secondary/50 text-secondary-foreground border border-secondary/40 dark:bg-secondary/50 dark:text-secondary-foreground dark:border-secondary/30"
                      : "clipboard-image-badge badge-hover"
                  }`}>
                  {/* 原来这里先渲染 record.type 再渲染中文标签，文本类型会拼成
                      「text文本」；直接渲染一次中文标签，图片则图标 + 文字 */}
                  {record.type === "text" ? (
                    "文本"
                  ) : (
                    <>
                      <ImageIcon className="h-3 w-3" />
                      图片
                    </>
                  )}
                </span>
                {/*
                  操作按钮组 — 只留每天都会点的 4 个（复制 / 置顶 / 编辑 / 删除），
                  其余进「更多」。icon-only + hover tooltip，操作栏宽度固定，
                  窄窗口下也不会把卡片横向顶开。

                  删除压在**最后一位**：破坏性按钮夹在一堆可逆操作中间，
                  连点两下的间隔最短就误触到了，移到末尾之后它前面隔着的
                  「更多」下拉还兼具一步减速的作用。
                */}
                <div className="ml-auto flex items-center gap-0.5">
                  {/* 置顶项展开后给一个明确的收起入口，否则展开就成了单向操作 */}
                  {isPinned && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => togglePinnedExpanded(recordId)}
                          variant="ghost"
                          aria-label="收起置顶项"
                          className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50 hover:bg-muted hover:text-foreground">
                          <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">收起</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => handleCopyRecord(record, recordId)}
                        variant={copiedId === recordId ? "secondary" : "ghost"}
                        aria-label="复制内容"
                        className={`h-8 w-8 p-0 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/50 ${
                          copiedId === recordId
                            ? "copy-success-btn"
                            : "hover:bg-muted hover:text-foreground active:scale-95"
                        }`}>
                        {copiedId === recordId ? (
                          <Check className="h-3.5 w-3.5 copy-success-check" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      <p className="text-xs">{copiedId === recordId ? "已复制" : "复制内容"}</p>
                    </TooltipContent>
                  </Tooltip>

                  {onTogglePin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onTogglePin(record)}
                          variant="ghost"
                          aria-label={isPinned ? "取消置顶" : "置顶"}
                          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50 ${
                            isPinned
                              ? "text-primary bg-primary/15 hover:bg-primary/20"
                              : "hover:bg-primary/10 hover:text-primary"
                          }`}>
                          <Pin className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">{isPinned ? "取消置顶" : "置顶"}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {/* 图片没有正文可改，所以编辑按钮只对文本记录出现 */}
                  {record.type === "text" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => (isEditing ? cancelEdit() : startEdit(record, recordId))}
                          variant="ghost"
                          aria-label={isEditing ? "退出编辑" : "编辑内容"}
                          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary/50 ${
                            isEditing
                              ? "text-primary bg-primary/15 hover:bg-primary/20"
                              : "hover:bg-primary/10 hover:text-primary"
                          }`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">{isEditing ? "退出编辑" : "编辑内容"}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  <RecordMoreMenu
                    items={moreMenuItems}
                    triggerClassName="hover:bg-muted hover:text-foreground"
                  />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => record.id !== undefined ? onDeleteRecord(record.id) : null}
                        variant="ghost"
                        aria-label="删除记录"
                        className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-destructive/50 btn-delete-hover hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      <p className="text-xs">删除记录</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* 内容行：占满宽度。文本区双击即复制，省掉一次点击按钮。
                  编辑态下换成 textarea + 保存/取消，正文读法完全变了，
                  所以两套是互斥渲染，不是叠在一起。 */}
              {record.type === "text" ? (
                isEditing ? (
                  <div className="clipboard-edit-area animate-fade-in">
                    <textarea
                      ref={editAreaRef}
                      value={editingDraft}
                      autoFocus
                      spellCheck={false}
                      aria-label="编辑剪贴板内容"
                      onChange={(e) => setEditingDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl/⌘+Enter 保存：长文本改完直接回车会插换行，
                        // 键入里必须有第二个修饰键可用，而 Esc 在任何输入法下都直通
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void saveEdit(record, recordId);
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      className="w-full min-h-[120px] max-h-[420px] resize-y rounded-md bg-muted/30 pl-3 pr-2 py-2 border border-primary/40
                        font-mono text-sm leading-relaxed text-foreground outline-none
                        focus:border-primary/70 focus:ring-2 focus:ring-primary/25 transition-all duration-150"
                    />
                    <div className="flex items-center justify-between gap-2 pt-2">
                      <span className="text-[11px] text-muted-foreground/70 tracking-wide">
                        <kbd className="kbd-key">{modifierLabel}</kbd>
                        <span className="mx-0.5">+</span>
                        <kbd className="kbd-key">Enter</kbd>
                        <span className="mx-1.5">保存</span>
                        <kbd className="kbd-key">Esc</kbd>
                        <span className="ml-1.5">取消</span>
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button
                          onClick={cancelEdit}
                          disabled={savingId === recordId}
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2.5 text-xs transition-colors duration-150 hover:bg-muted">
                          取消
                        </Button>
                        <Button
                          onClick={() => void saveEdit(record, recordId)}
                          disabled={
                            savingId === recordId ||
                            editingDraft.trim() === "" ||
                            editingDraft === record.content
                          }
                          size="sm"
                          className="h-7 px-2.5 text-xs transition-all duration-150 active:scale-95 disabled:opacity-50">
                          {savingId === recordId ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              保存中
                            </>
                          ) : (
                            <>
                              <Save className="h-3 w-3" />
                              保存
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <pre
                    onDoubleClick={() => handleCopyRecord(record, recordId)}
                    title="双击复制到剪贴板"
                    className={`code-block cursor-copy text-sm font-medium leading-relaxed whitespace-pre-wrap break-words font-mono ${
                      highlightLanguage
                        ? "code-block--highlight"
                        : "code-block--plain rounded-md bg-muted/30 pl-3 pr-2 py-2 border border-border/40"
                    }`}>
                    <code className={`${codeClassName} block`}>{record.content}</code>
                  </pre>
                )
              ) : (
                <div className="clipboard-img-preview">
                  <img
                    src={record.content}
                    alt="Clipboard Image"
                    className="max-w-full h-auto rounded-md shadow-sm cursor-pointer"
                    onClick={() => onImageClick(record.content)}
                  />
                </div>
              )}

              {/* 底部行：时间戳 + 复制成功提示 + 语言徽章
                  格式化/置顶等操作已移到顶部按钮组
                  原来的 border-t 分隔线去掉，改由卡片自身的拟态阴影划定区域 */}
              <div className="flex items-center gap-2 flex-wrap pt-1.5 -mt-px">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 tracking-wide transition-colors duration-150 group-hover:text-muted-foreground/75 cursor-default">
                      <Clock className="h-2.5 w-2.5 flex-shrink-0 opacity-60 group-hover:opacity-90 transition-opacity duration-150" />
                      {formatDistanceToNow(record.time, { addSuffix: true, locale: zhCN })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    <p className="text-xs font-medium">
                      {format(record.time, "yyyy-MM-dd HH:mm:ss", { locale: zhCN })}
                    </p>
                  </TooltipContent>
                </Tooltip>
                {/* Inline copy success badge — brief "已复制 ✓" indicator that appears
                    right after the timestamp when user copies a record */}
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
                    bg-success/10 text-success/80 border border-success/25
                    dark:bg-success/15 dark:text-success/90 dark:border-success/30
                    shadow-[0_0_8px_hsl(var(--success)/0.2)]
                    transition-all duration-200
                    ${copiedId === recordId ? "opacity-100 scale-100 copied-badge-spring" : "opacity-0 scale-90 pointer-events-none"}
                  `}
                  style={{ transition: "opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)" }}>
                  <Check className="h-2.5 w-2.5" style={{ strokeWidth: 2.5 }} />
                  已复制
                </span>
                {/* 语言徽章 — 当格式化语言已应用时，显示一个小药丸徽章，明确告知用户"语法高亮已激活"
                    编辑态下不显示：正文已经被 textarea 接管，高亮徽章只会干扰校对 */}
                {activeLanguageLabel && !isEditing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="lang-active-badge lang-badge-spring">
                        <Check className="h-2.5 w-2.5 flex-shrink-0" style={{ strokeWidth: 2.5 }} />
                        {activeLanguageLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      <p className="text-xs">语法高亮已应用：{activeLanguageLabel}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </Card>
        );
      })}
      </div>
    </div>
    </TooltipProvider>
  );
}
