import React from "react";
import { PenTool, FileText, ImageIcon, Code2, LucideIcon } from "lucide-react";
import { NOTE_TYPES, NoteType } from "../../../shared/noteTypes";
import { cn } from "@/lib/utils";

const ICONS: Record<NoteType, LucideIcon> = {
  excalidraw: PenTool,
  markdown: FileText,
  html: Code2,
  image: ImageIcon,
  // PDF 与图片都是二进制只读文档，图标沿用 FileText 的语义
  pdf: FileText,
};

interface NoteTypeTabsProps {
  active: NoteType;
  onChange: (type: NoteType) => void;
  /** 各类型下的文件数，显示在标签右侧，让空类型一眼可辨 */
  counts: Record<NoteType, number>;
  className?: string;
}

/**
 * 笔记类型切换栏
 *
 * 位于右侧内容区顶部：决定下方挂哪个编辑器。
 * 标签右侧的文件数来自左侧列表，能避免「切过去发现是空的」这种往返。
 */
export default function NoteTypeTabs({ active, onChange, counts, className }: NoteTypeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="笔记类型"
      className={cn("flex items-center gap-1 p-1 flex-shrink-0", className)}
      style={{ backgroundColor: "hsl(var(--muted) / 0.5)", borderRadius: "calc(var(--radius) * 0.9)" }}
    >
      {NOTE_TYPES.map(({ type, label }) => {
        const Icon = ICONS[type];
        const isActive = type === active;
        const count = counts[type] ?? 0;
        return (
          <button
            key={type}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(type)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-8 rounded-md text-sm font-medium",
              "transition-all duration-150 active:scale-95",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-card/60"
            )}
            style={isActive ? { color: "hsl(var(--primary))" } : undefined}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "text-[11px] tabular-nums px-1.5 h-[18px] leading-[18px] rounded-full",
                  isActive ? "bg-primary/15 text-primary" : "bg-muted-foreground/15 text-muted-foreground"
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
