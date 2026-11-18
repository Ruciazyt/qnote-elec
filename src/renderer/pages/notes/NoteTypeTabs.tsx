import React from "react";
import { PenTool, FileText, ImageIcon, Code2, LucideIcon } from "lucide-react";
import { NOTE_TYPES, NoteType } from "../../../shared/notes/noteTypes";
import { cn } from "@/lib/utils";

const ICONS: Record<NoteType, LucideIcon> = {
  excalidraw: PenTool,
  markdown: FileText,
  html: Code2,
  image: ImageIcon,
  pdf: FileText,
};

interface NoteTypeTabsProps {
  active: NoteType;
  onChange: (type: NoteType) => void;
  counts: Record<NoteType, number>;
  className?: string;
}

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
              "transition-[color,background-color,box-shadow,transform] duration-150 active:scale-95",
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
                  isActive ? "bg-primary/15 text-primary-strong" : "bg-muted-foreground/15 text-muted-foreground"
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
