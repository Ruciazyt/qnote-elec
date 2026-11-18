import React, { RefObject, useCallback, useState } from "react";
import { formatDistanceToNow, format, isSameDay, isToday, isYesterday } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Card } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  Copy, Trash2, Pin, PinOff, Star, Code, Check, Image as ImageIcon, Clock, ListChecks,
  NotebookPen, Loader2, ChevronDown, ChevronLeft, MoreHorizontal, Pencil, Save, StickyNote,
  ExternalLink, LayoutGrid,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { ClipboardRecord } from "./types";
import { getSupportedLanguages, SupportedLanguage } from "./codeFormatter";
import { detectUrl } from "@/utils/clipboard/urlDetect";
import { useAutoGrowTextarea } from "@/hooks/ui/useAutoGrowTextarea";
import { useStickyHold } from "@/hooks/sticky/useStickyHold";

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
  onOpenUrl?: (record: ClipboardRecord, url: string) => void;
  onAddToShortcut?: (record: ClipboardRecord, url: string) => void;
  onSaveAsNote?: (record: ClipboardRecord) => void;
  savingNoteId?: number | null;
  onUpdateContent?: (record: ClipboardRecord, content: string) => Promise<void>;
  onImageClick: (img: string) => void;
  codeContainerRef: RefObject<HTMLDivElement>;
}

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

function buildPreview(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}


interface MoreMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  panel?: (close: () => void) => React.ReactNode;
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
        if (!next) setPanelKey(null);
      }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label="更多操作"
          title="更多操作"
          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 ${triggerClassName}`}>
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
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={`w-full flex items-center gap-2.5 text-left text-xs px-2 py-1.5 rounded-md font-medium transition-all duration-150 active:scale-[0.98] ${
                  item.active
                    ? "text-primary-strong bg-primary/10"
                    : "text-foreground/85 hover:bg-primary/10 hover:text-primary-strong"
                }`}>
                <span className="flex-shrink-0">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.active && (
                  <Check className="h-3 w-3 text-primary-strong flex-shrink-0" style={{ strokeWidth: 2.5 }} />
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
  onOpenUrl,
  onAddToShortcut,
  onSaveAsNote,
  savingNoteId = null,
  onUpdateContent,
  onImageClick,
  codeContainerRef,
}: ClipboardListProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { getHoldProps, holding, holdNode } = useStickyHold();

  const [expandedPinned, setExpandedPinned] = useState<Set<number>>(new Set());
  const togglePinnedExpanded = (recordId: number) => {
    setExpandedPinned((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const editAreaRef = useAutoGrowTextarea(editingDraft);
  const attachEditArea = useCallback(
    (node: HTMLTextAreaElement | null) => {
      editAreaRef.current = node;
      if (node) node.focus();
    },
    [editAreaRef]
  );
  const modifierLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘" : "Ctrl";

  const startEdit = (record: ClipboardRecord, recordId: number) => {
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
    if (savingId === recordId) return;
    const next = editingDraft;
    if (next.trim() === "") return;
    if (next === record.content) {
      cancelEdit();
      return;
    }
    setSavingId(recordId);
    try {
      await onUpdateContent?.(record, next);
      cancelEdit();
    } catch {
    } finally {
      setSavingId(null);
    }
  };

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
              {}
              <Skeleton className="h-5 w-10 rounded flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-3">
                {}
                <Skeleton className="h-[72px] w-full rounded-md" />
                <div className="flex items-center gap-2 flex-wrap">
                  <Skeleton className="h-3 w-16 rounded" />
                  <Skeleton className="h-3 w-12 rounded" />
                </div>
              </div>
              {}
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

  if (clipboardHistory.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6 animate-fade-in" ref={codeContainerRef}>
        <div className="animate-fade-in-stagger text-center" style={{ animationDelay: "120ms" }}>
          <p className="text-sm font-semibold text-foreground/70 mb-1.5">暂无记录</p>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
            复制内容后将自动显示在这里
          </p>
        </div>
      </div>
    );
  }

  type RenderItem =
    | { kind: "card"; record: ClipboardRecord; recordId: number; index: number }
    | { kind: "separator"; label: string }
    | { kind: "pinned" };
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
    {
}
    <div className="relative flex flex-1 flex-col min-h-0 clipboard-scroll-container">
      {}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 h-6 pointer-events-none z-[1] clipboard-scroll-fade-top"
      />
      {}
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
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary-strong uppercase tracking-widest">
                <Pin className="h-2.5 w-2.5" />
                置顶
              </span>
            </div>
          );
        }

        if (item.kind === "separator") {
          return (
            <div key={`sep-${item.label}-${renderIndex}`} className="flex items-center justify-center my-4 py-1">
              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                {item.label}
              </span>
            </div>
          );
        }

        const { record, recordId, index } = item;
        const deferred = index >= 10;
        const highlightLanguage =
          typeof record.id === "number" ? formattedLanguages[record.id] : undefined;
        const codeClassName = highlightLanguage
          ? languageToPrismClass[highlightLanguage] || "language-none"
          : "language-none";
        const activeLanguageLabel = highlightLanguage
          ? getSupportedLanguages().find((l) => l.value === highlightLanguage)?.label
          : undefined;
        const isFormatLoading = formattingRecordId === recordId;
        const isPinned = Boolean(record.pinned_at);
        const isImportant = Boolean(record.is_important);
        const isEditing = editingId === recordId;
        const recordUrl = record.type === "text" ? detectUrl(record.content) : null;

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

        moreMenuItems.push({
          key: "sticky",
          label: "变成屏幕便签",
          icon: <StickyNote className="h-3.5 w-3.5" />,
          onSelect: () => {
            void window.electron.stickyCreate({
              type: record.type,
              content: record.content,
            });
          },
        });

        if (recordUrl && onAddToShortcut) {
          moreMenuItems.push({
            key: "shortcut",
            label: "添加到快捷方式",
            icon: <LayoutGrid className="h-3.5 w-3.5" />,
            onSelect: () => onAddToShortcut(record, recordUrl),
          });
        }

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
                    className="flex items-center justify-between text-left text-xs px-2 py-1.5 rounded-md font-medium text-foreground/85 hover:bg-primary/10 hover:text-primary-strong active:scale-[0.98] transition-all duration-150">
                    <span className="truncate">{lang.label}</span>
                    {highlightLanguage === lang.value && (
                      <Check className="h-3 w-3 text-primary-strong flex-shrink-0" style={{ strokeWidth: 2.5 }} />
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

        if (isPinned && !expandedPinned.has(recordId)) {
          const previewText = record.type === "text" ? buildPreview(record.content) : "";
          return (
            <Card
              key={recordId}
              className="relative p-0 border-0 animate-fade-in group card-accent-border neu-raised neu-raised-hover hover:-translate-y-1 hover:scale-[1.004]"
              style={{
                animationDelay: `${Math.min(index, 40) * 50}ms`,
                animationFillMode: "both",
              }}
              {...getHoldProps({ type: record.type, content: record.content })}>
              {
}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => togglePinnedExpanded(recordId)}
                  aria-expanded={false}
                  title={previewText ? previewText.slice(0, 200) : "图片记录"}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                  {}
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

                  {}
                  {record.type === "text" ? (
                    <span
                      className={`flex-1 min-w-0 truncate text-xs font-mono ${
                        recordUrl ? "text-link" : "text-foreground/80"
                      }`}>
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
                </button>

                {
}
                <div
                  className="flex items-center gap-0.5 flex-shrink-0"
                  role="group"
                  aria-label="记录操作">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => handleCopyRecord(record, recordId)}
                        variant={copiedId === recordId ? "secondary" : "ghost"}
                        aria-label="复制内容"
                        className={`h-8 w-8 p-0 transition-all duration-200 ${
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

                  {
}
                  {recordUrl && onOpenUrl && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onOpenUrl(record, recordUrl)}
                          variant="ghost"
                          aria-label="打开链接"
                          className="h-8 w-8 p-0 transition-all duration-150 hover:bg-primary/10 hover:text-primary-strong active:scale-95">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">在浏览器中打开</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {onTogglePin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onTogglePin(record)}
                          variant="ghost"
                          aria-label="取消置顶"
                          className="h-8 w-8 p-0 transition-all duration-150 text-primary-strong bg-primary/15 hover:bg-primary/15 active:scale-95">
                          {
}
                          <Pin className="h-3.5 w-3.5 fill-current" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">取消置顶</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {}
                  {record.type === "text" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => startEdit(record, recordId)}
                          variant="ghost"
                          aria-label="编辑内容"
                          className="h-8 w-8 p-0 transition-all duration-150 hover:bg-primary/10 hover:text-primary-strong active:scale-95">
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

                  {
}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => record.id !== undefined ? onDeleteRecord(record.id) : null}
                        variant="ghost"
                        aria-label="删除记录"
                        className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:!ring-destructive btn-delete-hover hover:bg-destructive/10 hover:text-destructive">
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
            className={`relative p-4 border-0 transition-all duration-200 group card-accent-border ${
              deferred ? "clipboard-card-virtual" : "animate-fade-in"
            } ${
              isEditing
                ? "z-50 neu-raised neu-raised-open"
                : "neu-raised neu-raised-hover hover:-translate-y-1 hover:scale-[1.004]"
            } ${holding ? "opacity-60" : ""}`}
            style={{
              animationDelay: deferred ? undefined : `${Math.min(index, 40) * 50}ms`,
              animationFillMode: "both",
            }}
            title="按住 1.2 秒即可变成屏幕便签"
            {...getHoldProps({ type: record.type, content: record.content })}>
            <div className="space-y-2">
              {}
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors badge-hover ${
                    record.type === "text"
                      ? "bg-secondary/50 text-secondary-foreground border border-secondary/40 dark:bg-secondary/50 dark:text-secondary-foreground dark:border-secondary/30"
                      : "clipboard-image-badge badge-hover"
                  }`}>
                  {
}
                  {record.type === "text" ? (
                    "文本"
                  ) : (
                    <>
                      <ImageIcon className="h-3 w-3" />
                      图片
                    </>
                  )}
                </span>
                {
}
                <div className="ml-auto flex items-center gap-0.5">
                  {}
                  {isPinned && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => togglePinnedExpanded(recordId)}
                          variant="ghost"
                          aria-label="收起置顶项"
                          className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 hover:bg-muted hover:text-foreground">
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
                        className={`h-8 w-8 p-0 transition-all duration-200 ${
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

                  {
}
                  {recordUrl && onOpenUrl && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onOpenUrl(record, recordUrl)}
                          variant="ghost"
                          aria-label="打开链接"
                          className="h-8 w-8 p-0 transition-all duration-150 hover:bg-primary/10 hover:text-primary-strong active:scale-95">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">在浏览器中打开</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {onTogglePin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => onTogglePin(record)}
                          variant="ghost"
                          aria-label={isPinned ? "取消置顶" : "置顶"}
                          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 ${
                            isPinned
                              ? "text-primary-strong bg-primary/15 hover:bg-primary/15"
                              : "hover:bg-primary/10 hover:text-primary-strong"
                          }`}>
                          {}
                          <Pin className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        <p className="text-xs">{isPinned ? "取消置顶" : "置顶"}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {}
                  {record.type === "text" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => (isEditing ? cancelEdit() : startEdit(record, recordId))}
                          variant="ghost"
                          aria-label={isEditing ? "退出编辑" : "编辑内容"}
                          className={`h-8 w-8 p-0 transition-all duration-150 active:scale-95 ${
                            isEditing
                              ? "text-primary-strong bg-primary/15 hover:bg-primary/15"
                              : "hover:bg-primary/10 hover:text-primary-strong"
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
                        className="h-8 w-8 p-0 transition-all duration-150 active:scale-95 focus-visible:!ring-destructive btn-delete-hover hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      <p className="text-xs">删除记录</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {
}
              {record.type === "text" ? (
                isEditing ? (
                  <div className="clipboard-edit-area animate-fade-in">
                    <textarea
                      ref={attachEditArea}
                      value={editingDraft}
                      spellCheck={false}
                      aria-label="编辑剪贴板内容"
                      onChange={(e) => setEditingDraft(e.target.value)}
                      onKeyDown={(e) => {
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
                        focus:border-primary/70 focus:ring-2 focus:ring-ring transition-all duration-150"
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
                  <button
                    type="button"
                    onDoubleClick={() => handleCopyRecord(record, recordId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleCopyRecord(record, recordId);
                      }
                    }}
                    title="双击复制到剪贴板"
                    className="block w-full text-left">
                    <pre
                      className={`code-block cursor-copy text-sm font-medium leading-relaxed whitespace-pre-wrap break-words font-mono ${
                        highlightLanguage
                          ? "code-block--highlight"
                          : "code-block--plain rounded-md bg-muted/30 pl-3 pr-2 py-2 border border-border/40"
                      }`}>
                      <code
                        className={`${codeClassName} block${recordUrl ? " code--link" : ""}`}
                        data-prism-lang={highlightLanguage}>
                        {record.content}
                      </code>
                    </pre>
                  </button>
                )
              ) : (
                <div className="clipboard-img-preview">
                  {
}
                  <button
                    type="button"
                    onClick={() => onImageClick(record.content)}
                    aria-label="查看剪贴板图片"
                    title="点击查看大图"
                    className="block w-full cursor-pointer">
                    <img
                      src={record.content}
                      alt="剪贴板中的内容"
                      className="max-w-full h-auto rounded-md shadow-sm"
                    />
                  </button>
                </div>
              )}

              {
}
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
                {
}
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
                    bg-background text-success border border-success/25
                    dark:bg-success/15 dark:text-success dark:border-success/30
                    shadow-[0_0_8px_hsl(var(--success)/0.2)]
                    transition-all duration-200
                    ${copiedId === recordId ? "opacity-100 scale-100 copied-badge-spring" : "opacity-0 scale-90 pointer-events-none"}
                  `}
                  style={{ transition: "opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)" }}>
                  <Check className="h-2.5 w-2.5" style={{ strokeWidth: 2.5 }} />
                  已复制
                </span>
                {
}
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
    {holdNode}
    </TooltipProvider>
  );
}
